const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium-min');
const cheerio = require('cheerio');

// Vercel Serverless Function
module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP address is required' });

    const targetUrl = ip.startsWith('http') ? ip : `http://${ip}`;
    let browser = null;

    try {
        console.log(`Launching browser for: ${targetUrl}`);
        
        // Configure for Vercel environment
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(
                "https://github.com/Sparticuz/chromium/releases/download/v121.0.0/chromium-v121.0.0-pack.tar"
            ),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        
        // Set aggressive timeout for serverless limits (10s max usually)
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 8000 });
        
        // Get screenshot as base64 (since we can't save files locally in serverless)
        const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
        const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer}`;

        const content = await page.content();
        const $ = cheerio.load(content);
        
        // Parsing logic
        const results = {
            timestamp: new Date().toISOString(),
            parameters: []
        };

        // Extract parameters (generic table scraper)
        $('tr').each((i, el) => {
            const text = $(el).text().toLowerCase();
            if (text.includes('pressure') || text.includes('temp') || text.includes('cold') || text.includes('comp') || text.includes('state')) {
                const cells = $(el).find('td').map((j, td) => $(td).text().trim()).get();
                if (cells.length >= 2) {
                    results.parameters.push({
                        name: cells[0],
                        value: cells[1]
                    });
                }
            }
        });

        res.status(200).json({ 
            success: true, 
            data: results, 
            screenshot: screenshotDataUrl 
        });

    } catch (error) {
        console.error('Scan error:', error);
        res.status(500).json({ error: 'Failed to scan device: ' + error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
};
