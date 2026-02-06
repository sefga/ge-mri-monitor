const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Эндпоинт для парсинга
app.post('/api/scan', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP address is required' });

    const targetUrl = ip.startsWith('http') ? ip : `http://${ip}`;
    
    try {
        console.log(`Scanning: ${targetUrl}`);
        
        // Используем Puppeteer для рендеринга JS (если веб-интерфейс динамический)
        const browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: "new"
        });
        const page = await browser.newPage();
        
        // Устанавливаем таймаут
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Делаем скриншот для отладки
        const screenshotPath = path.join(__dirname, 'public', 'last_scan.png');
        await page.screenshot({ path: screenshotPath });

        // Получаем контент
        const content = await page.content();
        const $ = cheerio.cheerio.load(content);
        
        await browser.close();

        // Логика извлечения данных (нужно подстроить под реальный HTML)
        // Ищем ключевые слова: Coldhead, Cryocompressor, Pressure, Temp
        const results = {
            timestamp: new Date().toISOString(),
            raw_text: $('body').text().substring(0, 1000), // Для отладки
            parameters: []
        };

        // Пример поиска по таблицам
        $('tr').each((i, el) => {
            const text = $(el).text().toLowerCase();
            if (text.includes('pressure') || text.includes('temp') || text.includes('cold') || text.includes('comp')) {
                const cells = $(el).find('td').map((j, td) => $(td).text().trim()).get();
                if (cells.length >= 2) {
                    results.parameters.push({
                        name: cells[0],
                        value: cells[1]
                    });
                }
            }
        });

        // Сохраняем результат
        const historyPath = path.join(__dirname, 'history.json');
        let history = [];
        if (fs.existsSync(historyPath)) {
            history = JSON.parse(fs.readFileSync(historyPath));
        }
        history.push({ ip, ...results });
        fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));

        res.json({ success: true, data: results, screenshot: '/last_scan.png' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to scan device: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
