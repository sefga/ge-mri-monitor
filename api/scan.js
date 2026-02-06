const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium-min');
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
    // Remove trailing slash if present
    const rootUrl = baseUrl.replace(/\/$/, '');
    
    let browser = null;

    try {
        console.log(`Connecting to: ${rootUrl}`);
        
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
        // Increased timeout for multi-step process
        page.setDefaultNavigationTimeout(15000); 

        // 1. LOGIN
        console.log('Step 1: Login');
        await page.goto(`${rootUrl}/index.html`, { waitUntil: 'domcontentloaded' });
        
        // Handle login form if present
        const loginForm = await page.$('form[name="login"]');
        if (loginForm) {
            console.log('Login form found, authenticating...');
            await page.type('input[name="UserName"]', username);
            await page.type('input[name="PassWord"]', password);
            
            await Promise.all([
                page.click('input[value="Submit"]'),
                page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(e => console.log('Navigation timeout/error handled'))
            ]);
        } else {
            console.log('No login form found, assuming already logged in or basic auth not required.');
        }

        // 2. SCRAPE DATA (Multi-page)
        const results = {
            timestamp: new Date().toISOString(),
            parameters: []
        };

        // Helper to scrape a page
        const scrapePage = async (path) => {
            const url = `${rootUrl}/${path}`;
            console.log(`Scraping: ${url}`);
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                const content = await page.content();
                const $ = cheerio.load(content);
                
                // MagMon looks for input fields named ChXX in form 'curVal'
                $('input').each((i, el) => {
                    const name = $(el).attr('name');
                    const value = $(el).val();
                    
                    if (name && name.startsWith('Ch')) {
                        const label = PARAM_MAP[name] || name;
                        // Only add if it has a value and is mapped (or we want raw data)
                        if (value && value.trim() !== '') {
                            results.parameters.push({
                                id: name,
                                name: label,
                                value: value.trim()
                            });
                        }
                    }
                });
            } catch (e) {
                console.error(`Failed to scrape ${path}:`, e.message);
            }
        };

        // Scrape coldhead.html
        await scrapePage('coldhead.html');
        
        // Scrape cur_a_vals.html
        await scrapePage('cur_a_vals.html');

        // Screenshot of the last state (likely cur_a_vals)
        const screenshotBuffer = await page.screenshot({ encoding: 'base64' });
        const screenshotDataUrl = `data:image/png;base64,${screenshotBuffer}`;

        res.status(200).json({ 
            success: true, 
            data: results, 
            screenshot: screenshotDataUrl 
        });

    } catch (error) {
        console.error('Critical error:', error);
        res.status(500).json({ error: 'Device connection failed: ' + error.message });
    } finally {
        if (browser) await browser.close();
    }
};
