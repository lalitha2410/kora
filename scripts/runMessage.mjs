// Types a single message into the currently-selected cart's WhatsApp
// thread and waits for the reply — used to reproduce a specific reported
// exchange rather than a scripted scenario. Usage:
//   node scripts/runMessage.mjs "<cart select-option label substring>" "<message>" <out-prefix> [port]
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const cartLabel = process.argv[2];
const message = process.argv[3];
const prefix = process.argv[4] ?? 'message';
const port = process.argv[5] ?? '5173';
if (!cartLabel || !message) {
  console.error('Usage: node scripts/runMessage.mjs "<cart label>" "<message>" <out-prefix> [port]');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});

if (cartLabel !== '-') {
  await page.selectOption('select', { label: cartLabel });
  await page.waitForTimeout(200);
}

await page.fill('input[placeholder="Type a message"]', message);
await page.click('button[aria-label="Send"]');

let lastCount = -1;
let stableTicks = 0;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  await page.waitForTimeout(1500);
  const typing = await page.locator('[data-typing="true"], [data-streaming="true"]').count();
  const bubbleCount = await page.locator('[data-role]').count();
  if (typing === 0) {
    if (bubbleCount === lastCount) {
      stableTicks += 1;
      if (stableTicks >= 2) break;
    } else {
      stableTicks = 0;
    }
  } else {
    stableTicks = 0;
  }
  lastCount = bubbleCount;
}

await page.screenshot({ path: `${outDir}/${prefix}-chat.png` });

const transcript = await page.locator('[data-role]').allInnerTexts();
console.log('--- TRANSCRIPT ---');
for (const t of transcript) console.log(t.replace(/\n/g, ' | '));

console.log('--- CONSOLE (llmProvider/useCartRecoveryAgent lines + errors) ---');
for (const l of consoleLines) {
  if (/llmProvider|useCartRecoveryAgent|error|warn/i.test(l)) console.log(l);
}

await browser.close();
