// Reproduces the reported over-triggering bug: price objection -> agent
// justifies (and may internally call an alternative-finding tool without
// ever presenting it) -> customer says a bare "ok" -> the cart must NOT be
// silently swapped unless an alternative was actually shown to the
// customer first. Runs the price-objection turn, then "ok", and reports
// whether selectAlternative fired and whether the swap was legitimate
// (i.e. the prior turn's visible reply actually named the item).
// Usage: node scripts/verifyNoSwapWithoutPresentation.mjs [port]
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const port = process.argv[2] ?? '5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});
await page.selectOption('select', 'CART-008');
await page.waitForTimeout(200);

async function sendAndWait(message) {
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
}

await sendAndWait("Hi, it's lovely but honestly ₹4999 is more than I wanted to spend on this one. Any discount available?");
await sendAndWait('ok');

await page.screenshot({ path: `${outDir}/no-swap-chat.png` });

const transcript = await page.locator('[data-role]').allInnerTexts();
console.log('--- TRANSCRIPT ---');
for (const t of transcript) console.log(t.replace(/\n/g, ' | '));

console.log('--- CONSOLE (llmProvider/useCartRecoveryAgent lines + errors) ---');
for (const l of consoleLines) {
  if (/llmProvider|useCartRecoveryAgent|error|warn/i.test(l)) console.log(l);
}

await browser.close();
