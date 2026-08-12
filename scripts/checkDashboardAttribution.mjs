// Screenshots the dashboard after the opt-out-then-reengage scenario has
// already run (state persists in the SAME page since no reload happens) —
// run immediately after runScenario.mjs in the same session is not
// possible across separate node invocations (each launches a fresh
// browser), so this re-runs the scenario itself, then screenshots.
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const port = process.argv[2] ?? '5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});

await page.click('text=Play scenario');
await page.click('text=Opts out, then messages back in and buys');

let lastCount = -1;
let stableTicks = 0;
const deadline = Date.now() + 180000;
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

await page.screenshot({ path: `${outDir}/attribution-full.png` });

// Zoom on the secondary stats strip + the CART-012 table row specifically.
const statsBox = await page.locator('text=Customer-initiated').locator('..').boundingBox();
console.log('Customer-initiated tile bounding box:', statsBox);

const row = page.locator('[data-testid="cart-row"]', { hasText: 'Vikram Malhotra' });
await row.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${outDir}/attribution-full-scrolled.png` });

const rowText = await row.innerText();
console.log('CART-012 row text:', rowText.replace(/\n/g, ' | '));

const heroText = await page.locator('text=Revenue recovered').locator('..').innerText().catch(() => '(not found)');
console.log('Hero "Revenue recovered" block text:', heroText.replace(/\n/g, ' | '));

await browser.close();
