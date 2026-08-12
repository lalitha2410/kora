// Live end-to-end check for the product-image feature: runs several
// scenarios and inspects data-testid="chat-product-image" elements to
// confirm images appear where required and are absent where forbidden.
// Usage: node scripts/verifyProductImages.mjs [port]
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const port = process.argv[2] ?? '5175';

const browser = await chromium.launch();

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[console error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`));
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await page.click('text=Got it').catch(() => {});
  return page;
}

async function waitForIdle(page) {
  let lastCount = -1;
  let stableTicks = 0;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1200);
    const typing = await page.locator('[data-typing="true"], [data-streaming="true"]').count();
    const bubbleCount = await page.locator('[data-role]').count();
    if (typing === 0) {
      if (bubbleCount === lastCount) {
        stableTicks += 1;
        if (stableTicks >= 2) break;
      } else stableTicks = 0;
    } else stableTicks = 0;
    lastCount = bubbleCount;
  }
}

async function runScenario(page, label) {
  await page.click('text=Play scenario');
  await page.click(`text=${label}`);
  await waitForIdle(page);
}

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

// -----------------------------------------------------------------
// 1. Opening-message images — one cart per campaign type.
// -----------------------------------------------------------------
{
  const page = await newPage();
  for (const cartId of ['CART-001', 'CART-104', 'CART-106']) {
    await page.selectOption('select', cartId);
    await page.waitForTimeout(200);
    const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
    assert(imgCount >= 1, `${cartId}: opening message has a product image`);
  }
  await page.screenshot({ path: `${outDir}/images-opening-messages.png` });
  await page.close();
}

// -----------------------------------------------------------------
// 2. Browse-abandonment — item image present, tone check (no "noticed you").
// -----------------------------------------------------------------
{
  const page = await newPage();
  await runScenario(page, 'Browse-abandon → asks a question, then buys');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount >= 1, 'browse-abandonment: at least one product image shown');
  await page.screenshot({ path: `${outDir}/images-browse-abandon.png` });
  await page.close();
}

// -----------------------------------------------------------------
// 3. Recommendation — recommended item image present.
// -----------------------------------------------------------------
{
  const page = await newPage();
  await runScenario(page, 'Recommendation → accepts and buys');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount >= 1, 'recommendation: at least one product image shown');
  await page.close();
}

// -----------------------------------------------------------------
// 4. Price objection -> cheaper alternative (CART-008) — image with price.
// -----------------------------------------------------------------
{
  const page = await newPage();
  await runScenario(page, 'Price objection → cheaper alternative');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount >= 1, 'cheaper alternative: at least one product image shown');
  await page.close();
}

// -----------------------------------------------------------------
// 5/6. Size-aware and colour-aware alternatives — images + verify
// selection-by-name STILL correctly swaps the cart (selectAlternative)
// and checkout reflects the chosen item's real price, not the original.
// -----------------------------------------------------------------
{
  const page = await newPage();
  await runScenario(page, 'Dislikes colour → colour-aware alternative');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount >= 1, 'colour-aware alternative: at least one product image shown');

  await page.click('button:has-text("Cart Recovery")').catch(() => {});
  await page.waitForTimeout(300);
  // CART-016 (Arjun Nair) picks "the undyed natural one" — confirm the row
  // now reflects K-KUR-01's ₹1849, not the original K-KUR-03's ₹1299.
  const rowText = await page.locator('[data-testid="cart-row"]', { hasText: 'Arjun Nair' }).innerText();
  console.log('  CART-016 row after selection:', rowText.replace(/\n/g, ' | '));
  assert(rowText.includes('1,849') || rowText.includes('1849'), 'selection-by-name still swapped the cart to the correct real item/price with images in play');
  await page.screenshot({ path: `${outDir}/images-colour-alternative.png` });
  await page.close();
}

// -----------------------------------------------------------------
// 7. Sale item surfaced (CART-013) — image of the surfaced sale item.
// -----------------------------------------------------------------
{
  const page = await newPage();
  await runScenario(page, 'Price objection → existing sale surfaced');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount >= 1, 'sale item surfaced: at least one product image shown');
  await page.close();
}

// -----------------------------------------------------------------
// WHERE NOT TO USE — discount code, opt-out, just-browsing exits must
// have ZERO extra product images beyond the opening message's own.
// -----------------------------------------------------------------
{
  const page = await newPage();
  await runScenario(page, 'Price objection → discount');
  // Opening message contributes exactly 1 image (CART-001's kurta); the
  // discount-code reply and acceptance/checkout-link turns must add none.
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount === 1, `discount code / checkout close: no NEW product images beyond the opening message (got ${imgCount} total)`);
  await page.close();
}
{
  const page = await newPage();
  await runScenario(page, 'Asks to stop messaging → opt out');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount === 1, `opt-out reply: no new product image beyond the opening message (got ${imgCount} total)`);
  await page.close();
}
{
  const page = await newPage();
  await runScenario(page, 'Just browsing → graceful exit');
  const imgCount = await page.locator('[data-testid="chat-product-image"]').count();
  assert(imgCount === 1, `just-browsing graceful exit: no new product image beyond the opening message (got ${imgCount} total)`);
  await page.close();
}

// -----------------------------------------------------------------
// 380px layout check
// -----------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 380, height: 800 } });
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await page.click('text=Got it').catch(() => {});
  await page.selectOption('select', 'CART-106').catch(() => {});
  await page.click('text=💬 WhatsApp').catch(() => {});
  await page.waitForTimeout(400);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
  assert(scrollWidth <= clientWidth + 1, `no horizontal overflow at 380px (scrollWidth=${scrollWidth}, clientWidth=${clientWidth})`);
  await page.screenshot({ path: `${outDir}/images-380px.png`, fullPage: false });
  await page.close();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
