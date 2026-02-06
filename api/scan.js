const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const cheerio = require('cheerio');

// Mapping based on MagMon source code
const PARAM_MAP = {
    'Ch15': 'Helium Pressure',
    'Ch1': 'Helium Level',
    'Ch16': 'Water Flow 1',
    'Ch17': 'Water Temp 1',
    'Ch25': 'Water Flow 2',
    'Ch26': 'Water Temp 2',
    'Ch3': 'He Level Top Current',
    'Ch4': 'He Level Top',
    'Ch5': 'Recon RuO Current',
    'Ch6': 'Recon RuO',
    'Ch8': 'Shield Temp Current',
    'Ch9': 'Shield Temp',
    'Ch18': 'SC Pressure',
    'Ch32': 'Magmon Case Temp'
};

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { ip, username = 'MMService', password = 'MagnetMonitor' } = req.body;
    if (!ip) return res.status(400).json({ error: 'IP address is required' });

    // Normalize URL
    const baseUrl = ip.startsWith('http') ? ip : `http://${ip}`;
    const rootUrl = baseUrl.replace(/\/$/, '');
    
    let browser = null;

    try {
        console.log(`Connecting to: ${rootUrl}`);
        
        // Use full Chromium package which includes necessary libs
        // Note: executablePath URL is often not needed for @sparticuz/chromium if local install is correct,
        // but we keep it empty to let the lib resolve it or download if needed.
        // Actually, for Vercel, we often don't need to specify executablePath if using the package's helper.
        // But let's try the standard way first.
        
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true,
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(15000); 

        // 1. LOGIN
        console.log('Step 1: Login');
        try {
            await page.goto(`${rootUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        } catch (e) {
            throw new Error(`Failed to load ${rootUrl}: ${e.message}`);
        }
        
        const loginForm = await page.$('form[name="login"]');
        if (loginForm) {
            console.log('Login form found, authenticating...');
            await page.type('input[name="UserName"]', username);
            await page.type('input[name="PassWord"]', password);
            
            await Promise.all([
                page.click('input[value="Submit"]'),
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {})
            ]);
        }

        // 2. SCRAPE DATA
        const results = {
            timestamp: new Date().toISOString(),
            parameters: []
        };

        const scrapePage = async (path) => {
            const url = `${rootUrl}/${path}`;
            console.log(`Scraping: ${url}`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                const content = await page.content();
                const $ = cheerio.load(content);
                
                $('input').each((i, el) => {
                    const name = $(el).attr('name');
                    const value = $(el).val();
                    if (name && name.startsWith('Ch') && value && value.trim() !== '') {
                        const label = PARAM_MAP[name] || name;
                        results.parameters.push({ id: name, name: label, value: value.trim() });
                    }
                });
            } catch (e) {
                console.error(`Failed to scrape ${path}:`, e.message);
            }
        };

        await scrapePage('coldhead.html');
        await scrapePage('cur_a_vals.html');

        const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
        const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer}`;

        res.status(200).json({ success: true, data: results, screenshot: screenshotDataUrl });

    } catch (error) {
        console.error('Critical error:', error);
        res.status(500).json({ error: 'Device connection failed: ' + error.message });
    } finally {
        if (browser) await browser.close();
    }
};
