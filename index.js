import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Разрешаем CORS запросы с фронтенда
app.use(cors());

// Настройка Multer для получения файлов в память
const upload = multer({ storage: multer.memoryStorage() });

// Инициализация клиента Google Gen AI
// Автоматически берет GEMINI_API_KEY из process.env
const ai = new GoogleGenAI({});

// Ультимативные промпты для физики чернил и материалов
const PRINT_PROMPTS = {
    'B2': 'Silk screen printing effect (Plastisol ink). The ink has a slight physical thickness and a matte finish. The cotton fabric weave is subtly visible underneath. Natural stretching and micro-cracking around deep folds.',
    'D2': 'Silk screen printing with transfer. High opacity ink, crisp edges, very slight rubbery texture reflecting soft studio light. Deeply integrated into the fabric surface.',
    'DTF3': 'Direct-to-Film (DTF) transfer print. Vibrant, highly saturated colors. The print sits on top of the fabric with a very smooth, micro-textured semi-matte surface. Sharp vector-like boundaries.',
    'F1': 'Polyurethane heat transfer vinyl (Flex film). Solid, perfectly uniform colors with a distinct semi-gloss reflection. The material is thick enough to hide the fabric weave completely. Razor-sharp die-cut edges.',
    'F2': 'Premium heat transfer vinyl (Flex film). Solid uniform colors, slight semi-gloss reflection under studio lights. Razor-sharp edges, perfectly bonded to the garment shape without losing its vinyl texture.',
    'DTG2': 'Direct-to-Garment (DTG) water-based ink print. The ink is completely absorbed deep into the cotton fibers. Zero physical thickness. The fabric texture and grain are fully visible through the colors. Very soft, breathable appearance, slightly muted vintage color profile.'
};

app.post('/api/apply-print', upload.single('garmentImage'), async (req, res) => {
    try {
        const file = req.file;
        const { printType, modelGender, garmentColor } = req.body;

        if (!file) {
            return res.status(400).json({ error: 'Missing garmentImage.' });
        }

        if (!printType || !PRINT_PROMPTS[printType]) {
            return res.status(400).json({ 
                error: `Invalid or missing printType. Supported: ${Object.keys(PRINT_PROMPTS).join(', ')}` 
            });
        }

        if (!modelGender || !garmentColor) {
            return res.status(400).json({ error: 'Missing modelGender or garmentColor.' });
        }

        const garmentBuffer = file.buffer;
        const mimeTypeIn = file.mimetype || 'image/jpeg';

        // Определяем тип модели, пол, одежду и позу на основе входящего параметра
        // Поддерживаем как старый modelGender, так и новые расширенные типы
        const modelType = (req.body.modelType || req.body.modelGender || 'man').toLowerCase();
        
        let gender = 'man';
        let garmentDescription = 't-shirt';
        let poseDescription = 'facing the camera, showing the front of the garment';
        let refFileName = 'man_black_chest.png'; // Дефолтный референс

        switch (modelType) {
            case 'woman':
            case 'woman_shirt_front':
                gender = 'woman';
                refFileName = 'model-female.jpg';
                break;
            case 'man_shirt_back':
                gender = 'man';
                refFileName = 'man_black_chest.png'; // Берем тот же референс, но просим повернуть
                poseDescription = 'TURNED AROUND, facing AWAY from the camera, showing the BACK of the t-shirt. The model must be viewed from behind.';
                break;
            case 'woman_shirt_back':
                gender = 'woman';
                refFileName = 'model-female.jpg'; // Берем женский референс, но просим повернуть
                poseDescription = 'TURNED AROUND, facing AWAY from the camera, showing the BACK of the t-shirt. The model must be viewed from behind.';
                break;
            case 'man_jacket':
                gender = 'man';
                refFileName = 'man_black_chest.png'; // Берем тот же референс, но переодеваем
                garmentDescription = 'sleeveless puffer jacket (vest)';
                break;
            case 'woman_jacket':
                gender = 'woman';
                refFileName = 'model-female.jpg'; // Берем женский референс, но переодеваем
                garmentDescription = 'sleeveless puffer jacket (vest)';
                break;
            case 'man':
            case 'man_shirt_front':
            default:
                gender = 'man';
                refFileName = 'man_black_chest.png';
                break;
        }

        // Ищем референсную фотографию
        let referenceImageBuffer = null;
        let referenceMimeType = refFileName.endsWith('.png') ? 'image/png' : 'image/jpeg';
        
        const refPath = path.join(process.cwd(), 'assets', 'mockups', refFileName);
        if (fs.existsSync(refPath)) {
            referenceImageBuffer = fs.readFileSync(refPath);
        } else {
            console.warn(`Reference image not found at: ${refPath}. Falling back to text-only generation for pose.`);
        }

        // Базовая инструкция: генерируем фотореалистичную студийную съемку с нуля по плоскому эскизу
        const BASE_POSITIVE_PROMPT = referenceImageBuffer 
            ? `You are an expert fashion retoucher. You are provided with TWO images.
Image 1 (Pose Reference): A photo of a model.
Image 2 (Garment Design): A flat lay of a ${garmentDescription} with a specific design.

TASK: Generate a photorealistic image of a handsome ${gender} wearing the ${garmentColor} ${garmentDescription} from Image 2.
CRITICAL: The model MUST be ${poseDescription}.
If Image 1 is provided, use its lighting, camera angle, and general vibe, but ensure the pose strictly matches: "${poseDescription}".

CRITICAL PLACEMENT RULES:
- First, carefully analyze WHERE the logo/graphic is located on the flat garment in Image 2.
- You MUST place the graphic in that EXACT same relative position on the 3D model. 
- If the graphic is at the bottom in Image 2, it MUST be at the bottom on the model. DO NOT automatically put it on the chest!
- The garment color MUST be exactly ${garmentColor}.`
            : `Generate a photorealistic studio fashion portrait of a handsome ${gender} wearing a ${garmentColor} ${garmentDescription}. CRITICAL: The model MUST be ${poseDescription}. The design, logo placement, and scale on the garment MUST EXACTLY match the provided reference image. Translate the flat 2D clothing design into a realistic 3D worn garment with natural folds and studio lighting.`;

        // Негативный промпт: отсекаем частые ошибки генерации людей и одежды
        const NEGATIVE_PROMPT = "ugly, deformed face, unrealistic proportions, distorted logo, bad anatomy, text rendering errors, wrong garment color, flat, 2D overlay, floating text, sticker-like, ignored shadows, mismatched lighting, digital artifact, changed pose, changed camera angle.";

        // Формируем финальный промпт
        const specificPrompt = PRINT_PROMPTS[printType];
        const finalPrompt = `${BASE_POSITIVE_PROMPT} ${specificPrompt} NEGATIVE PROMPT: ${NEGATIVE_PROMPT}`;

        // Собираем массив контента для ИИ
        const contentsArray = [finalPrompt];
        
        // Если есть референс позы (Image 1), добавляем его первым
        if (referenceImageBuffer) {
            contentsArray.push({
                inlineData: {
                    mimeType: referenceMimeType,
                    data: referenceImageBuffer.toString('base64')
                }
            });
        }
        
        // Добавляем эскиз от фронтенда (Image 2)
        contentsArray.push({
            inlineData: {
                mimeType: mimeTypeIn,
                data: garmentBuffer.toString('base64')
            }
        });

        // Отправляем запрос к Gemini (gemini-2.5-flash-image) через generateContent
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', 
            contents: contentsArray
        });

        // Извлекаем картинку из ответа
        let generatedImageBuffer = null;
        let mimeTypeOut = 'image/jpeg';

        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts) {
                for (const part of candidate.content.parts) {
                    if (part.inlineData && part.inlineData.data) {
                        generatedImageBuffer = Buffer.from(part.inlineData.data, 'base64');
                        mimeTypeOut = part.inlineData.mimeType || mimeTypeOut;
                        break;
                    }
                }
            }
        }

        if (!generatedImageBuffer) {
            throw new Error('AI failed to generate image or returned text instead of an image.');
        }

        // Возвращаем результат клиенту
        res.set('Content-Type', mimeTypeOut);
        res.send(generatedImageBuffer);

    } catch (error) {
        console.error('Error applying print:', error);
        res.status(500).json({ 
            error: 'Failed to apply print', 
            details: error.message 
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Ready to apply prints at POST http://localhost:${PORT}/api/apply-print`);
});