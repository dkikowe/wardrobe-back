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

// Базовая инструкция: разрешаем ИИ искажать и поворачивать принт по складкам ткани, но строго запрещаем менять цвет одежды и фон
const BASE_POSITIVE_PROMPT = "The provided image contains a draft design on a garment. Transform this draft into a photorealistic printed mockup. You MUST warp, rotate, and adjust the design's perspective so it perfectly wraps around the 3D geometry, folds, wrinkles, and shadows of the fabric. Make it look 100% physically authentic to the printing method. CRITICAL: DO NOT change the color of the garment. DO NOT change the background, lighting, or the human subject.";

// Негативный промпт: отсекаем плоские наклейки и смену цвета одежды
const NEGATIVE_PROMPT = "Changed garment color, altered background, flat, 2D overlay, floating text, sticker-like, ignored fabric folds, ignored shadows, mismatched lighting, unrealistic, digital artifact.";

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
        const printType = req.body.printType;

        if (!file) {
            return res.status(400).json({ error: 'Missing garmentImage.' });
        }

        if (!printType || !PRINT_PROMPTS[printType]) {
            return res.status(400).json({ 
                error: `Invalid or missing printType. Supported: ${Object.keys(PRINT_PROMPTS).join(', ')}` 
            });
        }

        const garmentBuffer = file.buffer;
        const mimeTypeIn = file.mimetype || 'image/jpeg';

        // Формируем финальный промпт
        const specificPrompt = PRINT_PROMPTS[printType];
        const finalPrompt = `${BASE_POSITIVE_PROMPT} ${specificPrompt} IMPORTANT: The garment color MUST remain exactly the same. DO NOT change the garment color, geometry, background, or lighting. ONLY restyle the logo area to match the requested print texture. NEGATIVE PROMPT: ${NEGATIVE_PROMPT}`;

        // Отправляем запрос к Gemini (gemini-2.5-flash-image) через generateContent
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', // Используем модель для генерации изображений
            contents: [
                finalPrompt,
                {
                    inlineData: {
                        mimeType: mimeTypeIn,
                        data: garmentBuffer.toString('base64')
                    }
                }
            ]
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