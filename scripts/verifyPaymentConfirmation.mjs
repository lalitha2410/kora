// Verifies the full intent-vs-payment redesign on CART-008:
// 1. A weak "ok" to a single presented alternative asks a confirming
//    question instead of silently swapping.
// 2. A real "yes" after that confirmation actually swaps.
// 3. Checkout produces exactly one real link (brand-config format), and
//    the cart moves to 'checkout_sent', NOT 'recovered' — Revenue
//    Recovered must stay at whatever it was before.
// 4. A further "ok" does not re-send the link (conversation closed).
// 5. Clicking the dashboard's "Mark as paid" control is what actually
//    moves the cart to 'recovered' and updates Revenue Recovered.
// Usage: node scripts/verifyPaymentConfirmation.mjs [port]
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
await sendAndWait('yes');
await sendAndWait('great, please send the checkout link');
await sendAndWait('ok');

await page.screenshot({ path: `${outDir}/payment-chat.png` });

const transcript = await page.locator('[data-role]').allInnerTexts();
console.log('--- TRANSCRIPT ---');
for (const t of transcript) console.log(t.replace(/\n/g, ' | '));

console.log('--- CONSOLE (llmProvider/useCartRecoveryAgent lines + errors) ---');
for (const l of consoleLines) {
  if (/llmProvider|useCartRecoveryAgent|error|warn/i.test(l)) console.log(l);
}

// Check dashboard state BEFORE marking paid.
await page.click('button:has-text("Campaign")').catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/payment-dashboard-before.png` });

const heroBefore = await page.locator('text=Revenue recovered').locator('..').innerText().catch(() => '(not found)');
console.log('--- Hero "Revenue recovered" BEFORE mark-paid ---');
console.log(heroBefore.replace(/\n/g, ' | '));

const row = page.locator('[data-testid="cart-row"]', { hasText: 'Farah Sheikh' });
await row.scrollIntoViewIfNeeded();
const rowTextBefore = await row.innerText();
console.log('--- CART-008 row BEFORE mark-paid ---');
console.log(rowTextBefore.replace(/\n/g, ' | '));

// Click "Mark paid" on the row.
await row.locator('button:has-text("Mark paid")').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/payment-dashboard-after.png` });

const heroAfter = await page.locator('text=Revenue recovered').locator('..').innerText().catch(() => '(not found)');
console.log('--- Hero "Revenue recovered" AFTER mark-paid ---');
console.log(heroAfter.replace(/\n/g, ' | '));

const rowTextAfter = await row.innerText();
console.log('--- CART-008 row AFTER mark-paid ---');
console.log(rowTextAfter.replace(/\n/g, ' | '));

await browser.close();
