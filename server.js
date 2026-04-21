import express from 'express';
import mockupRouter from './mockup.controller.js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Подключаем роутер
app.use(mockupRouter);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Ready to generate mockups at POST http://localhost:${PORT}/api/generate-realistic-mockup`);
});
