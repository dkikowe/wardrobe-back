import express from 'express';
import multer from 'multer';
import dotenv from 'dotenv';
import cors from 'cors';
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

// Профили печати с явными "MUST" ограничениями, чтобы модель не усредняла стиль
const PRINT_PROFILES = {
    B2: {
        label: 'B2 / Screen print plastisol',
        prompt: 'MUST look like plastisol screen printing: matte ink, slight physical thickness, subtle micro-cracks on deep folds, visible cotton weave through ink.',
        boost: 'Emphasize tactile matte ink body and subtle edge buildup. Keep colors slightly dense, not glossy.',
    },
    D2: {
        label: 'D2 / Screen print transfer',
        prompt: 'MUST look like transfer-based screen print: high-opacity ink, crisp edges, slightly rubberized surface, soft studio reflections, tightly bonded to fabric.',
        boost: 'Emphasize clean transfer edges and uniform opacity with mild rubber-like reflectance.',
    },
    DTF3: {
        label: 'DTF3 / Direct-to-Film',
        prompt: 'MUST look like DTF transfer: vibrant saturated colors, smooth micro-textured semi-matte surface, clear top-layer feel above fabric, sharp vector-like boundaries.',
        boost: 'Increase color saturation and contrast on print area only; preserve garment color outside print.',
    },
    F1: {
        label: 'F1 / Flex vinyl',
        prompt: 'MUST look like polyurethane flex vinyl: solid uniform fills, distinct semi-gloss reflections, thicker film appearance, razor-sharp die-cut edges.',
        boost: 'Add stronger specular highlights on the print surface to show vinyl film behavior.',
    },
    F2: {
        label: 'F2 / Premium flex vinyl',
        prompt: 'MUST look like premium heat-transfer vinyl: smooth uniform color fields, clean semi-gloss highlights, crisp contour edges, bonded while retaining vinyl character.',
        boost: 'Keep premium clean finish: controlled semi-gloss highlights, very crisp clean contours, no ink bleed.',
    },
    DTG2: {
        label: 'DTG2 / Water-based DTG',
        prompt: 'MUST look like water-based DTG print: zero physical thickness, ink absorbed deeply into cotton fibers, fabric grain fully visible through print, slightly muted vintage tones.',
        boost: 'Reduce print saturation slightly and avoid specular shine; prioritize absorbed-ink softness and breathable look.',
    },
};

app.post('/api/apply-print', upload.single('garmentImage'), async (req, res) => {
    try {
        const file = req.file;
        const printTypeRaw = req.body.printType;
        const modelGender = (req.body.modelGender || 'man').toLowerCase();

        if (!file) {
            return res.status(400).json({ error: 'Missing garmentImage.' });
        }

        const printType = (printTypeRaw || '').toUpperCase().trim();

        if (!printType || !PRINT_PROFILES[printType]) {
            return res.status(400).json({ 
                error: `Invalid or missing printType. Supported: ${Object.keys(PRINT_PROFILES).join(', ')}` 
            });
        }

        if (!['man', 'woman'].includes(modelGender)) {
            return res.status(400).json({ error: 'Invalid modelGender. Supported: man, woman.' });
        }

        const garmentBuffer = file.buffer;
        const mimeTypeIn = file.mimetype || 'image/jpeg';
        
        const personDescription = modelGender === 'woman' ? 'woman model' : 'man model';
        const BASE_POSITIVE_PROMPT = `Generate a photorealistic full-body studio fashion photo of a ${personDescription} wearing a t-shirt.
Use the uploaded flat garment design image as the authoritative source for the t-shirt visual design.
CRITICAL: Keep the logo/text layout, placement, scale, spacing, and proportions exactly as in the provided garment image.
Transform the flat design into a realistic worn t-shirt with natural folds, fabric tension, and physically correct lighting.`;

        // Негативный промпт: отсекаем частые ошибки генерации людей и одежды
        const NEGATIVE_PROMPT = 'ugly, deformed face, unrealistic proportions, distorted logo, bad anatomy, text rendering errors, wrong garment color';

        // Формируем финальный промпт с жесткой фиксацией одного профиля печати
        const selectedProfile = PRINT_PROFILES[printType];
        const finalPrompt = `${BASE_POSITIVE_PROMPT}
PRINT METHOD ID: ${printType}
PRINT METHOD NAME: ${selectedProfile.label}
PRINT TEXTURE REQUIREMENT: ${selectedProfile.prompt}
STYLE BOOST: ${selectedProfile.boost}
CRITICAL: apply ONLY this print method appearance. Do NOT blend styles from other methods.
NEGATIVE PROMPT: ${NEGATIVE_PROMPT}`;

        console.log(`[apply-print] method=${printType}, gender=${modelGender}`);

        // Отправляем запрос к Gemini (gemini-2.5-flash-image) через generateContent
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', 
            contents: [
                finalPrompt,
                {
                    inlineData: {
                        mimeType: mimeTypeIn,
                        data: garmentBuffer.toString('base64'),
                    },
                },
            ],
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