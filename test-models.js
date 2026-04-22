import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();
const ai = new GoogleGenAI({});
async function run() {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: [
                'Generate a red circle',
                {
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: Buffer.from('test').toString('base64')
                    }
                }
            ]
        });
        console.log(response.candidates[0].content.parts);
    } catch (e) {
        console.error(e);
    }
}
run();
