import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const router = express.Router();

// Настройка Multer для хранения файлов в оперативной памяти
const upload = multer({ storage: multer.memoryStorage() });

// Инициализация клиента Google Gen AI
// SDK автоматически подхватит GEMINI_API_KEY из .env
const ai = new GoogleGenAI({});

// ЛОГИКА ДЛЯ ВИДОВ НАНЕСЕНИЯ (Маппинг)
const PRINT_METHODS_MAPPING = {
    'B2': 'realistic textured screen print, visible ink texture integrated into fabric weave, slight thickness to ink',
    'D2': 'realistic textured screen print, visible ink texture integrated into fabric weave, slight thickness to ink',
    'DTF3': 'smooth digital transfer print, vibrant colors, bonded to fabric fibers, matte finish',
    'F1': 'smooth cut vinyl film heat-pressed, slightly reflective surface, sharp edges, bonded to fabric',
    'F2': 'smooth cut vinyl film heat-pressed, slightly reflective surface, sharp edges, bonded to fabric',
    'DTG2': 'direct-to-garment water-based ink print, ink absorbed deep into cotton fibers, soft hand feel, slightly muted colors',
};

/**
 * Контроллер для генерации фотореалистичного мокапа
 */
router.post(
    '/api/generate-realistic-mockup',
    upload.fields([
        { name: 'baseGarmentImage', maxCount: 1 },
        { name: 'logoImage', maxCount: 1 },
        { name: 'printMaskImage', maxCount: 1 }
    ]),
    async (req, res) => {
        try {
            // Проверка наличия всех необходимых файлов и параметров
            const { files, body } = req;
            if (!files.baseGarmentImage || !files.logoImage || !files.printMaskImage) {
                return res.status(400).json({ error: 'Missing required image files.' });
            }

            const printMethodId = body.printMethodId;
            if (!printMethodId || !PRINT_METHODS_MAPPING[printMethodId]) {
                return res.status(400).json({ 
                    error: `Invalid or missing printMethodId. Supported IDs: ${Object.keys(PRINT_METHODS_MAPPING).join(', ')}` 
                });
            }

            const baseGarmentBuffer = files.baseGarmentImage[0].buffer;
            const logoBuffer = files.logoImage[0].buffer;
            const maskBuffer = files.printMaskImage[0].buffer;

            // 1. Получаем координаты области нанесения из маски для будущего кропа и позиционирования
            // trim() убирает прозрачные/черные пиксели, оставляя только саму маску (белую область)
            const { info: maskInfo } = await sharp(maskBuffer)
                .trim()
                .toBuffer({ resolveWithObject: true });

            const boundingBox = {
                left: maskInfo.trimOffsetLeft * -1, // sharp возвращает отрицательные смещения при trim
                top: maskInfo.trimOffsetTop * -1,
                width: maskInfo.width,
                height: maskInfo.height
            };

            // 2. Подготавливаем "черновое" изображение: накладываем логотип на одежду в зону маски
            // Логотип масштабируется под размер маски (с сохранением пропорций)
            const resizedLogo = await sharp(logoBuffer)
                .resize({
                    width: boundingBox.width,
                    height: boundingBox.height,
                    fit: 'inside'
                })
                .toBuffer();

            const draftGarmentBuffer = await sharp(baseGarmentBuffer)
                .composite([{ input: resizedLogo, top: boundingBox.top, left: boundingBox.left }])
                .png()
                .toBuffer();

            // 6. Формирование финального промпта
            const printMethodPrompt = PRINT_METHODS_MAPPING[printMethodId];
            const finalPrompt = `Apply this logo precisely to the masked area on the chest of the t-shirt, maintain natural fabric folds and studio lighting integration. ${printMethodPrompt}`;

            // 3. Вызов Google Vertex AI / Imagen 3 для Inpainting (редактирования)
            // Мы передаем черновое изображение и маску. ИИ "впечет" логотип реалистично.
            const response = await ai.models.editImage({
                model: 'imagen-3.0-capability', // Актуальная модель Imagen для редактирования
                prompt: finalPrompt,
                image: {
                    mimeType: 'image/png',
                    data: draftGarmentBuffer.toString('base64')
                },
                mask: {
                    mimeType: 'image/png',
                    data: maskBuffer.toString('base64')
                },
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/png',
                    // Параметры для Imagen (могут варьироваться в зависимости от версии API)
                    editMode: 'INPAINT_INSERTION' 
                }
            });

            if (!response.generatedImages || response.generatedImages.length === 0) {
                throw new Error('AI failed to generate image.');
            }

            const generatedImageBase64 = response.generatedImages[0].image.data;
            const generatedImageBuffer = Buffer.from(generatedImageBase64, 'base64');

            // 7. КАДРИРОВАНИЕ (Пост-обработка)
            // Добавляем отступы (padding), чтобы принт не был прижат к краям
            const padding = 100; 
            const cropRegion = {
                left: Math.max(0, boundingBox.left - padding),
                top: Math.max(0, boundingBox.top - padding),
                width: boundingBox.width + (padding * 2),
                height: boundingBox.height + (padding * 2)
            };

            // Получаем метаданные сгенерированного изображения, чтобы не выйти за границы при кропе
            const genImageMetadata = await sharp(generatedImageBuffer).metadata();
            
            // Корректируем ширину и высоту, если они выходят за пределы картинки
            cropRegion.width = Math.min(cropRegion.width, genImageMetadata.width - cropRegion.left);
            cropRegion.height = Math.min(cropRegion.height, genImageMetadata.height - cropRegion.top);

            const finalCroppedImageBuffer = await sharp(generatedImageBuffer)
                .extract(cropRegion)
                .png()
                .toBuffer();

            // 8. Отправка ответа клиенту
            res.set('Content-Type', 'image/png');
            res.send(finalCroppedImageBuffer);

        } catch (error) {
            console.error('Error generating mockup:', error);
            res.status(500).json({ 
                error: 'Failed to generate mockup', 
                details: error.message 
            });
        }
    }
);

export default router;
