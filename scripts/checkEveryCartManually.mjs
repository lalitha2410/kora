// Selects EVERY cart in the dropdown manually (not via "Play scenario")
// and sends one generic objection message, to confirm each cart works
// standalone even though most have no dedicated scenario. Reports the
// opening message, the reply, and any console/page errors per cart.
// Usage: node scripts/checkEveryCartManually.mjs [port]
import { chromium } from 'playwright';

const port = process.argv[2] ?? '5175';
const CARTS = [
  'CART-001', 'CART-002', 'CART-003', 'CART-004', 'CART-005', 'CART-006',
  'CART-007', 'CART-008', 'CART-009', 'CART-010', 'CART-011', 'CART-012',
  'CART-013', 'CART-014', 'CART-015', 'CART-016',
  'CART-104', 'CART-105', 'CART-106', 'CART-107',
];
const MESSAGE = "Hi! Is this still available, and is there any chance of a discount on it?";

const browser = await chromium.launch();
const results = [];

for (const cartId of CARTS) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /useCartRecoveryAgent|STATE MACHINE/i.test(msg.text())) errors.push(`console: ${msg.text()}`);
  });

  try {
    await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
    await page.click('text=Got it').catch(() => {});
    await page.selectOption('select', cartId);
    await page.waitForTimeout(300);

    const openingText = await page.locator('[data-role="agent"]').first().innerText();

    const input = page.locator('input[type="text"]');
    await input.fill(MESSAGE);
    await input.press('Enter');

    let lastCount = -1, stableTicks = 0;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1200);
      const typing = await page.locator('[data-typing="true"], [data-streaming="true"]').count();
      const bubbleCount = await page.locator('[data-role]').count();
      if (typing === 0) {
        if (bubbleCount === lastCount) { stableTicks++; if (stableTicks >= 2) break; } else stableTicks = 0;
      } else stableTicks = 0;
      lastCount = bubbleCount;
    }

    const agentBubbles = await page.locator('[data-role="agent"]').allInnerTexts();
    const reply = agentBubbles[agentBubbles.length - 1] ?? '(no reply)';
    const isFallback = /trouble (reaching|completing)/i.test(reply) || /rate-limited/i.test(reply);

    results.push({ cartId, openingText: openingText.slice(0, 90), reply: reply.slice(0, 220), errors, isFallback });
  } catch (err) {
    results.push({ cartId, openingText: '(failed)', reply: `EXCEPTION: ${err.message}`, errors, isFallback: true });
  } finally {
    await page.close();
  }
}

console.log(JSON.stringify(results, null, 2));
await browser.close();

const problems = results.filter((r) => r.errors.length > 0 || r.isFallback || r.reply === '(no reply)');
console.log(`\n${results.length} carts tested, ${problems.length} with issues`);
process.exit(problems.length === 0 ? 0 : 1);
