// Same idea as runMessage.mjs but selects the cart dropdown by its real
// value (the cartId) instead of a label substring — avoids brittleness
// from the "CART-XXX · FirstName" label format.
// Usage: node scripts/runMessageByValue.mjs <cartId> "<message>" <out-prefix> [port]
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const cartId = process.argv[2];
const message = process.argv[3];
const prefix = process.argv[4] ?? 'message';
const port = process.argv[5] ?? '5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});
await page.selectOption('select', cartId);
await page.waitForTimeout(300);

await page.fill('input[type="text"]', message);
await page.press('input[type="text"]', 'Enter');

let lastCount = -1;
let stableTicks = 0;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  await page.waitForTimeout(1500);
  const typing = await page.locator('[data-typing="true"], [data-streaming="true"]').count();
  const bubbleCount = await page.locator('[data-role]').count();
  if (typing === 0) {
    if (bubbleCount === lastCount) { stableTicks++; if (stableTicks >= 2) break; } else stableTicks = 0;
  } else stableTicks = 0;
  lastCount = bubbleCount;
}

const transcript = await page.locator('[data-role]').allInnerTexts();
console.log('--- TRANSCRIPT ---');
for (const t of transcript) console.log(t.replace(/\n/g, ' | '));

console.log('--- CONSOLE (llmProvider/useCartRecoveryAgent/guardrail lines) ---');
for (const l of consoleLines) {
  if (/llmProvider|useCartRecoveryAgent|guardrail|error|warn/i.test(l)) console.log(l);
}

await page.screenshot({ path: `${outDir}/${prefix}.png` });
await browser.close();
