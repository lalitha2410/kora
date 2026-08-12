// Screenshots just the chat-panel header (top ~70px of the left panel) for
// a given app instance — used to verify the WhatsApp Business header
// change (brand name + verified badge) on both Kora and Vastra.
// Usage: node scripts/screenshotHeader.mjs <out-name> <port>
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const outName = process.argv[2] ?? 'header';
const port = process.argv[3] ?? '5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 300 } });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/${outName}.png`, clip: { x: 0, y: 0, width: 480, height: 160 } });
await browser.close();
console.log(`Saved ${outName}.png`);
