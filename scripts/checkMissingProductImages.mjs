// Confirms the graceful-degradation behavior: with no files in
// public/products/ yet, every product image should be silently omitted
// (no broken-image icon in the DOM, no page error), while the caption
// text/message content still renders normally.
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const port = process.argv[2] ?? '5175';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.message));

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});
await page.selectOption('select', 'CART-106');
// Let the (failing) image request resolve and the onError handler fire.
await page.waitForTimeout(1500);

const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
console.log(`data-testid=chat-product-image elements present: ${imgCount} (expected 0 — file 404s and hides itself)`);

const bubbleText = await page.locator('[data-role="agent"]').first().innerText();
console.log('First agent bubble text still renders:', bubbleText.includes('Meher') ? 'yes' : bubbleText.slice(0, 80));

console.log(`page errors: ${pageErrors.length}`);
for (const e of pageErrors) console.log(' ', e);

await page.screenshot({ path: `${outDir}/missing-image-graceful.png` });
await browser.close();
process.exit(imgCount === 0 && pageErrors.length === 0 ? 0 : 1);
