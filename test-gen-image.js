import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({});
async function run() {
    try {
        const response = await ai.models.generateImages({
            model: 'imagen-3.0-generate-001',
            prompt: 'A red circle',
            config: { numberOfImages: 1, outputMimeType: 'image/jpeg' }
        });
        console.log(response.generatedImages[0].image.mimeType);
    } catch (e) {
        console.error(e);
    }
}
run();
