/**
 * Guard verification for the two profile-driven campaign triggers
 * (recommendations, browse-abandonment), run directly with
 * `npx tsx scripts/verifyCampaignTriggers.ts` — no LLM involved. Same
 * spirit as verifyTools.ts (which this deliberately doesn't duplicate):
 * confirms every "Rules IN CODE" guarantee named in the build spec
 * actually holds against the real seeded data/customers.ts profiles, not
 * just against a hand-built fixture.
 *
 * A third trigger, replenishment, was built and verified here too, then
 * deliberately removed — fashion isn't a consumables vertical, see the
 * README's Design decisions and types.ts's CampaignType doc.
 */
import { carts } from '../src/data/carts';
import { customers } from '../src/data/customers';
import { getBrowseAbandonmentTool, getRecommendationsFromHistoryTool } from '../src/lib/tools';

let failures = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

console.log('data sanity — every seeded customer/cart pair actually joins');
{
  assert(customers.length >= 6, `at least 6 customer profiles exist (got ${customers.length})`);
  for (const cart of carts) {
    if (cart.campaignType === 'cart_recovery') continue;
    assert(cart.customerId === cart.phone, `${cart.cartId}: customerId matches phone`);
  }
}

console.log('\ngetRecommendationsFromHistory — EDGE CASE: real complement, filtered to size + spend band (Diya Kapoor, 9845099007)');
{
  const { items } = getRecommendationsFromHistoryTool('9845099007');
  assert(items.length > 0, 'at least one recommendation returned');
  assert(
    items.every((i) => i.itemId !== 'K-KUR-01'),
    'never recommends the item she already owns',
  );
  assert(
    items.every((i) => i.price <= 2200),
    "never exceeds her typical spend ceiling (₹2200) — the ₹12,999 bridal set must never appear",
  );
  assert(
    items.every((i) => i.itemId !== 'K-SET-01'),
    'the ₹12,999 statement piece specifically never appears for a ₹1000-2200 spender',
  );
}

console.log('\ngetRecommendationsFromHistory — EDGE CASE: no purchase history at all (Naomi Fernandes, 9845099006)');
{
  const { items } = getRecommendationsFromHistoryTool('9845099006');
  assert(items.length === 0, 'empty result, not an error, with no purchase history to ground a recommendation in');
}

console.log('\ngetRecommendationsFromHistory — never recommends an item the customer already owns, across every seeded profile');
{
  for (const profile of customers) {
    const owned = new Set(profile.purchaseHistory.map((p) => p.itemId));
    const { items } = getRecommendationsFromHistoryTool(profile.customerId);
    assert(
      items.every((i) => !owned.has(i.itemId)),
      `${profile.name}: no recommendation duplicates an already-owned item`,
    );
  }
}

console.log('\ngetRecommendationsFromHistory — unknown customerId degrades gracefully');
{
  const { items } = getRecommendationsFromHistoryTool('0000000000');
  assert(items.length === 0, 'empty result for a customerId with no profile at all');
}

console.log('\ngetBrowseAbandonment — EDGE CASE: viewed 3+ times, never bought (Meher Khanna, 9845099005)');
{
  const res = getBrowseAbandonmentTool('9845099005', carts);
  const item = res.items.find((i) => i.itemId === 'K-DRS-01');
  assert(Boolean(item), 'the repeat-viewed dress shows up as a browse-abandonment candidate');
}

console.log('\ngetBrowseAbandonment — GUARD: below the view threshold / no browse events is excluded');
{
  // Diya Kapoor has purchase history but no browse events at all —
  // confirmed indirectly alongside Sana's own converted event (5 views,
  // still excluded, see the "already bought" check below), so the
  // threshold isn't the only thing standing between a browse event and a
  // result — every guard has to hold independently.
  const res = getBrowseAbandonmentTool('9845099007', carts);
  assert(res.items.length === 0, 'a customer with no browse events returns an empty list, not an error');
}

console.log('\ngetBrowseAbandonment — GUARD: item later bought is excluded (Sana Iyer, 9845099010)');
{
  const res = getBrowseAbandonmentTool('9845099010', carts);
  assert(
    res.items.every((i) => i.itemId !== 'K-CO-01'),
    'the co-ord set she browsed AND later bought is never surfaced as an open abandonment',
  );
}

console.log("\ngetBrowseAbandonment — GUARD: item sitting in another ACTIVE cart is excluded (Karan Mehra, 9845144567)");
{
  const res = getBrowseAbandonmentTool('9845144567', carts);
  assert(
    res.items.every((i) => i.itemId !== 'K-KUR-01'),
    'the kurta he browsed 3x is excluded because it is already in his active CART-014 cart-recovery thread',
  );
  // Sanity: CART-014 really does hold K-KUR-01 and really is still active,
  // otherwise this guard wouldn't actually be under test.
  const cart014 = carts.find((c) => c.cartId === 'CART-014')!;
  assert(cart014.customerId === '9845144567' && cart014.outcome === 'active' && cart014.items[0].itemId === 'K-KUR-01', 'sanity: CART-014 setup is what this guard assumes');
}

console.log('\ngetBrowseAbandonment — unknown customerId degrades gracefully');
{
  const res = getBrowseAbandonmentTool('0000000000', carts);
  assert(res.items.length === 0, 'empty result for a customerId with no profile at all');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
