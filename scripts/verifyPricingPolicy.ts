/**
 * Standalone verification of the pricing policy engine, run directly
 * against the seeded carts with `npx tsx scripts/verifyPricingPolicy.ts`
 * — no LLM, no React, no dev server. Per the build order, this must pass
 * before any function-calling wiring is written. Not a test framework
 * (no vitest in this project); a plain assert script is enough for a
 * handful of deterministic checks and needs zero extra dependencies. Lives
 * outside src/ so its Node-only globals (process.exit) don't pull `node`
 * types into the browser app's tsconfig.
 */
import { carts } from '../src/data/carts';
import {
  checkDiscountEligibility,
  MARGIN_FLOOR_PERCENT,
  MIN_CART_AGE_MS,
  tierCapPercent,
} from '../src/lib/pricingPolicy';

let failures = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

function cart(id: string) {
  const c = carts.find((x) => x.cartId === id);
  if (!c) throw new Error(`seed cart ${id} not found`);
  return c;
}

console.log(`Tier caps: <=2000 -> ${tierCapPercent(1500)}%, 2000-5000 -> ${tierCapPercent(3000)}%, >5000 -> ${tierCapPercent(9000)}%`);
console.log(`Margin floor: ${MARGIN_FLOOR_PERCENT}%, min cart age for a discount: ${MIN_CART_AGE_MS / 60000} min\n`);

console.log('CART-001 — regular kurta, old enough, no sale -> should be eligible, 10% tier');
{
  const r = checkDiscountEligibility(cart('CART-001'));
  assert(r.eligible === true, 'eligible');
  assert(r.maxDiscountPercent === 10, `maxDiscountPercent is 10 (got ${r.maxDiscountPercent})`);
}

console.log('\nCART-003 — ₹12,999 bridal set -> top tier, should cap at 15%');
{
  const r = checkDiscountEligibility(cart('CART-003'));
  assert(r.eligible === true, 'eligible');
  assert(r.maxDiscountPercent === 15, `maxDiscountPercent is 15 (got ${r.maxDiscountPercent})`);
  assert(r.cartValue === 12999, `cartValue is 12999 (got ${r.cartValue})`);
}

console.log('\nCART-004 — ₹699 single cheap item -> lowest tier, still some room');
{
  const r = checkDiscountEligibility(cart('CART-004'));
  assert(r.eligible === true, 'eligible');
  assert(r.maxDiscountPercent === 10, `maxDiscountPercent is 10 (got ${r.maxDiscountPercent})`);
}

console.log('\nCART-005 — item already on sale -> must be fully ineligible, 0%');
{
  const r = checkDiscountEligibility(cart('CART-005'));
  assert(r.eligible === false, 'not eligible');
  assert(r.maxDiscountPercent === 0, `maxDiscountPercent is 0 (got ${r.maxDiscountPercent})`);
  assert(r.reasons.some((x) => x.toLowerCase().includes('sale')), 'reason mentions sale');
}

console.log('\nCART-006 — abandoned 5 minutes ago -> too recent, ineligible');
{
  const r = checkDiscountEligibility(cart('CART-006'));
  assert(r.eligible === false, 'not eligible');
  assert(r.reasons.some((x) => x.toLowerCase().includes('recent')), 'reason mentions recency');
}

console.log('\nCART-008 — thin-margin item (20% margin == floor) -> margin blocks discount even though tier allows one');
{
  const r = checkDiscountEligibility(cart('CART-008'));
  assert(r.eligible === false, 'not eligible');
  assert(r.maxDiscountPercent === 0, `maxDiscountPercent is 0 (got ${r.maxDiscountPercent})`);
  assert(r.reasons.some((x) => x.toLowerCase().includes('margin')), 'reason mentions margin');
}

console.log('\nOne-offer guard — a cart with discountOffered=true must be ineligible regardless of everything else');
{
  const c = { ...cart('CART-001'), discountOffered: true };
  const r = checkDiscountEligibility(c);
  assert(r.eligible === false, 'not eligible once already offered');
  assert(r.reasons.some((x) => x.toLowerCase().includes('already')), 'reason mentions it was already offered');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
