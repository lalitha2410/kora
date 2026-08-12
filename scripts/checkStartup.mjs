// Loads the app just long enough to capture llmProvider.ts's startup
// provider-config log. Usage: node scripts/checkStartup.mjs [port]
import { chromium } from 'playwright';

const port = process.argv[2] ?? '5173';
const browser = await chromium.launch();
const page = await browser.newPage();
const lines = [];
page.on('console', (msg) => lines.push(msg.text()));

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

console.log(lines.join('\n'));
await browser.close();
