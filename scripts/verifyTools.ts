/**
 * Guard verification for tools.ts, run directly with
 * `npx tsx scripts/verifyTools.ts` — no LLM involved. Confirms the guards
 * called out in the build spec actually hold: single discount offer, no
 * overwriting a terminal outcome, the directional opt-out rule — the
 * brand can never re-initiate (outcome can never move away from
 * 'opted_out' again), but the customer messaging back in works normally —
 * and the intent-vs-payment split (createCheckoutLink only ever produces
 * 'checkout_sent'; only markCartPaidTool, the dashboard-only "Mark as
 * paid" control's backing function, can ever reach 'recovered'). Lives
 * outside src/ so its Node-only globals (process.exit) don't pull `node`
 * types into the browser app's tsconfig.
 */
import { carts } from '../src/data/carts';
import { amountPaidForCart } from '../src/lib/pricingPolicy';
import {
  checkDiscountEligibilityTool,
  createCheckoutLinkTool,
  findAlternativesByBudgetTool,
  findAlternativesByColourTool,
  findAlternativesBySizeTool,
  findSimilarItemsTool,
  generateDiscountCodeTool,
  getActiveSalesTool,
  getCartDetailsTool,
  markCartOutcomeTool,
  markCartPaidTool,
  removeCartItemTool,
  selectAlternativeTool,
} from '../src/lib/tools';

// Matches koraBrand.checkoutBaseUrl (config/brand.ts) — a literal here on
// purpose, so this test would actually FAIL if createCheckoutLinkTool ever
// stopped taking the base URL as a parameter and hardcoded something else
// again.
const CHECKOUT_BASE_URL = 'https://kora.in/checkout';

let failures = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}`);
  }
}

console.log('generateDiscountCode — second call on the same cart must refuse');
{
  let list = [...carts];
  const first = generateDiscountCodeTool(list, 'CART-001');
  assert(first.output.success === true, 'first call succeeds');
  list = list.map((c) => (c.cartId === 'CART-001' ? (first.cart as (typeof list)[number]) : c));
  const second = generateDiscountCodeTool(list, 'CART-001');
  assert(second.output.success === false, 'second call refused');
  assert(second.cart === null, 'second call does not produce a state update');
}

console.log('\nmarkCartOutcome — cannot overwrite a terminal outcome');
{
  let list = [...carts];
  const first = markCartOutcomeTool(list, 'CART-009', 'lost', 'already purchased elsewhere');
  assert(first.output.success === true, 'first markCartOutcome succeeds');
  list = list.map((c) => (c.cartId === 'CART-009' ? (first.cart as (typeof list)[number]) : c));
  const second = markCartOutcomeTool(list, 'CART-009', 'opted_out');
  assert(second.output.success === false, 'overwrite refused, even to a different outcome');
}

console.log("\ncreateCheckoutLink/markCartOutcome — 'recovered' is not reachable through either LLM tool");
{
  // Not just a runtime check: LlmSettableOutcome (types.ts) excludes
  // 'recovered' from markCartOutcomeTool's parameter type entirely, so
  // `markCartOutcomeTool(list, 'CART-001', 'recovered')` is a COMPILE
  // error, not just a refused call — this block only re-confirms the
  // runtime side (createCheckoutLink itself never sets 'recovered').
  let list = [...carts];
  const discount = generateDiscountCodeTool(list, 'CART-001');
  list = list.map((c) => (c.cartId === 'CART-001' ? (discount.cart as (typeof list)[number]) : c));
  const link = createCheckoutLinkTool(list, 'CART-001', CHECKOUT_BASE_URL, discount.output.discountCode);
  assert(link.output.success === true, 'checkout link created');
  const updated = link.cart as (typeof list)[number];
  assert(updated.outcome === 'checkout_sent', "createCheckoutLink sets outcome to 'checkout_sent', never 'recovered'");
  assert(
    updated.checkoutLink === `${CHECKOUT_BASE_URL}/CART-001?code=${discount.output.discountCode}`,
    'checkout link is built from the provided checkoutBaseUrl, single consistent format',
  );
}

console.log('\nOpted-out cart — customer-initiated tool use works normally (opt-out is directional, not a lockout)');
{
  let list = [...carts];
  const optOut = markCartOutcomeTool(list, 'CART-011', 'opted_out', 'asked to stop messaging');
  assert(optOut.output.success === true, 'opt-out itself succeeds');
  list = list.map((c) => (c.cartId === 'CART-011' ? (optOut.cart as (typeof list)[number]) : c));

  // Every tool call in the app only ever runs inside a reply to a customer
  // message (see useCartRecoveryAgent.ts's sendMessage) — there is no
  // brand-initiated path — so these all being callable here models exactly
  // that: the customer wrote back in, and the agent is responding normally.
  const details = getCartDetailsTool(list, 'CART-011');
  assert(details.output.success === true, 'getCartDetails works after opt-out (customer wrote back in)');

  const eligibility = checkDiscountEligibilityTool(list, 'CART-011');
  assert(eligibility.output.success === true, 'checkDiscountEligibility works after opt-out');

  const discount = generateDiscountCodeTool(list, 'CART-011');
  assert(discount.output.success === true, 'generateDiscountCode works after opt-out');
  list = list.map((c) => (c.cartId === 'CART-011' ? (discount.cart as (typeof list)[number]) : c));

  const checkout = createCheckoutLinkTool(list, 'CART-011', CHECKOUT_BASE_URL, discount.output.discountCode);
  assert(checkout.output.success === true, 'createCheckoutLink works after opt-out');
  list = list.map((c) => (c.cartId === 'CART-011' ? (checkout.cart as (typeof list)[number]) : c));

  const cart = list.find((c) => c.cartId === 'CART-011')!;
  assert(cart.outcome === 'opted_out', 'outcome stays opted_out even after a purchase — never silently reclassified');
  assert(
    cart.customerInitiatedRecovery?.checkoutLink === checkout.output.checkoutLink,
    'the purchase is tagged customerInitiatedRecovery, not a normal recovery',
  );
  assert(cart.customerInitiatedRecovery?.paid === false, 'sending the link is intent, not confirmed — paid starts false');

  // Sending a link is not a sale — see markCartPaidTool. Only the
  // dashboard's "Mark as paid" control (never the LLM) can flip this.
  const paid = markCartPaidTool(list, 'CART-011');
  assert(paid.output.success === true, "markCartPaid succeeds on a pending customer-initiated link");
  list = list.map((c) => (c.cartId === 'CART-011' ? (paid.cart as (typeof list)[number]) : c));
  const paidCart = list.find((c) => c.cartId === 'CART-011')!;
  assert(paidCart.outcome === 'opted_out', 'outcome itself is untouched by markCartPaid on this path — stays opted_out permanently');
  assert(paidCart.customerInitiatedRecovery?.paid === true, 'customerInitiatedRecovery.paid flips true once confirmed');

  // No stored recoveredValue field exists anymore (see AbandonedCart's own
  // doc) — the campaign-attributed revenueRecovered KPI (useCartRecoveryAgent.ts)
  // only ever sums amountPaidForCart over outcome === 'recovered' carts, and
  // this one stays 'opted_out' forever, so it's excluded by construction,
  // not by a separate flag that could drift out of sync with `outcome`.
  assert(paidCart.outcome !== 'recovered', 'never becomes outcome "recovered", so revenueRecovered can never include it');

  // The one thing that must STILL be permanently blocked: the brand's
  // side can never reclassify this cart as a normal 'recovered' win, no
  // matter what happened in the conversation.
  const remark = markCartOutcomeTool(list, 'CART-011', 'lost');
  assert(remark.output.success === false, 'markCartOutcome still refuses to move outcome away from opted_out');
}

console.log('\ncreateCheckoutLink/markCartPaid — checkout_sent -> recovered only via confirmed payment, never re-sends a link');
{
  let list = [...carts];
  const discount = generateDiscountCodeTool(list, 'CART-001');
  list = list.map((c) => (c.cartId === 'CART-001' ? (discount.cart as (typeof list)[number]) : c));
  const link = createCheckoutLinkTool(list, 'CART-001', CHECKOUT_BASE_URL, discount.output.discountCode);
  assert(link.output.success === true, 'first checkout link succeeds');
  list = list.map((c) => (c.cartId === 'CART-001' ? (link.cart as (typeof list)[number]) : c));

  const pendingCart = list.find((c) => c.cartId === 'CART-001')!;
  assert(pendingCart.outcome === 'checkout_sent', 'outcome is checkout_sent, not recovered, right after sending the link');

  const notYetPaid = markCartPaidTool(list, 'CART-001');
  assert(notYetPaid.output.success === true, 'markCartPaid succeeds on a checkout_sent cart');
  list = list.map((c) => (c.cartId === 'CART-001' ? (notYetPaid.cart as (typeof list)[number]) : c));
  const recoveredCart = list.find((c) => c.cartId === 'CART-001')!;
  assert(recoveredCart.outcome === 'recovered', 'outcome only becomes recovered once markCartPaid actually runs');

  const secondLink = createCheckoutLinkTool(list, 'CART-001', CHECKOUT_BASE_URL);
  assert(secondLink.output.success === false, 'second checkout link refused once recovered');

  const secondPaid = markCartPaidTool(list, 'CART-001');
  assert(secondPaid.output.success === false, 'markCartPaid refuses a cart that is not awaiting payment');
}

console.log('\ncreateCheckoutLink — refuses to create a second link once one already exists (no repeat sends)');
{
  let list = [...carts];
  const first = createCheckoutLinkTool(list, 'CART-002', CHECKOUT_BASE_URL);
  assert(first.output.success === true, 'first checkout link succeeds');
  list = list.map((c) => (c.cartId === 'CART-002' ? (first.cart as (typeof list)[number]) : c));

  const second = createCheckoutLinkTool(list, 'CART-002', CHECKOUT_BASE_URL);
  assert(second.output.success === false, 'second call refused while still checkout_sent (unpaid)');
  assert(
    second.output.error?.includes(first.output.checkoutLink ?? '__unmatched__'),
    'refusal points back at the SAME link rather than staying silent about it',
  );
}

console.log('\nfindAlternativesBySize — only returns items genuinely in stock in the requested size');
{
  const res = findAlternativesBySizeTool('K-KUR-01', 'L');
  assert(res.success === true, 'call succeeds');
  const ids = (res.items ?? []).map((i) => i.itemId);
  assert(ids.includes('K-KUR-02'), 'includes Sage kurta (L in stock)');
  assert(ids.includes('K-KUR-03'), 'includes Clay kurta (L in stock)');
  assert(!ids.includes('K-KUR-01'), 'never includes the source item itself');
  assert(
    (res.items ?? []).every((i) => i.availableSizes.includes('L')),
    'every returned item genuinely has L available',
  );
}

console.log('\nfindAlternativesBySize — a fully out-of-stock item never appears');
{
  const res = findAlternativesBySizeTool('K-CO-01', 'M');
  const ids = (res.items ?? []).map((i) => i.itemId);
  assert(!ids.includes('K-CO-02'), 'discontinued co-ord set excluded even though category matches');
}

console.log('\nfindAlternativesByBudget — respects the stated ceiling, same category only');
{
  const res = findAlternativesByBudgetTool('K-TRS-02', 2000);
  assert(res.success === true, 'call succeeds');
  const ids = (res.items ?? []).map((i) => i.itemId);
  assert(ids.includes('K-TRS-01'), 'includes the cheaper trousers (₹1999 <= ₹2000)');
  assert(
    (res.items ?? []).every((i) => i.price <= 2000),
    'every returned item is at or under the stated budget',
  );
}

console.log('\nfindAlternativesByColour — excludes the disliked colour, same category only');
{
  const res = findAlternativesByColourTool('K-KUR-03', 'Clay');
  assert(res.success === true, 'call succeeds');
  const ids = (res.items ?? []).map((i) => i.itemId);
  assert(ids.includes('K-KUR-01'), 'includes the undyed-natural kurta');
  assert(ids.includes('K-KUR-02'), 'includes the sage kurta');
  assert(
    (res.items ?? []).every((i) => i.colour.toLowerCase() !== 'clay'),
    'no returned item is the excluded colour',
  );
}

console.log('\nselectAlternative — swaps the cart item so pricing/checkout reflect the NEW item (the CART-008 bug)');
{
  let list = [...carts];
  const before = list.find((c) => c.cartId === 'CART-008')!;
  assert(before.items[0].itemId === 'K-DRS-03', 'sanity: CART-008 starts on the Limited Edition dress');
  assert(amountPaidForCart(before) === 4999, 'sanity: original item value is ₹4999');

  const swap = selectAlternativeTool(list, 'CART-008', 'K-DRS-01');
  assert(swap.output.success === true, 'swap succeeds');
  assert(swap.output.price === 2799, 'swap reports the NEW item price (Clay Hand Block-Print Midi Dress)');
  list = list.map((c) => (c.cartId === 'CART-008' ? (swap.cart as (typeof list)[number]) : c));

  const swapped = list.find((c) => c.cartId === 'CART-008')!;
  assert(swapped.items[0].itemId === 'K-DRS-01', "cart.items actually changed to the alternative's itemId");
  assert(amountPaidForCart(swapped) === 2799, 'derived amount now reflects the NEW item, not the original ₹4999');

  const checkout = createCheckoutLinkTool(list, 'CART-008', CHECKOUT_BASE_URL);
  assert(checkout.output.success === true, 'checkout succeeds after swap');
  assert(
    checkout.output.finalAmount === 2799,
    'createCheckoutLink prices the CURRENT (post-swap) item, not the original ₹4999',
  );
  list = list.map((c) => (c.cartId === 'CART-008' ? (checkout.cart as (typeof list)[number]) : c));

  const paid = markCartPaidTool(list, 'CART-008');
  list = list.map((c) => (c.cartId === 'CART-008' ? (paid.cart as (typeof list)[number]) : c));
  const finalCart = list.find((c) => c.cartId === 'CART-008')!;
  assert(finalCart.outcome === 'recovered', 'reaches recovered only via markCartPaid, after checkout_sent');
  assert(
    amountPaidForCart(finalCart) === 2799,
    'revenue derived for the dashboard after recovery also reflects the swapped item, not the original',
  );

  const secondSwap = selectAlternativeTool(list, 'CART-008', 'K-DRS-02');
  assert(secondSwap.output.success === false, 'selectAlternative refuses once a checkout link already exists');
}

console.log("\nselectAlternative — clears any discount minted for the OLD item (a different product's margin doesn't apply)");
{
  let list = [...carts];
  const discount = generateDiscountCodeTool(list, 'CART-001');
  assert(discount.output.success === true, 'discount generated on the original item');
  list = list.map((c) => (c.cartId === 'CART-001' ? (discount.cart as (typeof list)[number]) : c));

  const swap = selectAlternativeTool(list, 'CART-001', 'K-KUR-02');
  assert(swap.output.success === true, 'swap succeeds');
  list = list.map((c) => (c.cartId === 'CART-001' ? (swap.cart as (typeof list)[number]) : c));

  const swapped = list.find((c) => c.cartId === 'CART-001')!;
  assert(swapped.discountCode === undefined, "the old item's discount code does not carry over to the new item");
  assert(swapped.discountOffered === false, 'discountOffered resets so a fresh discount could be evaluated for the new item');
}

console.log('\ngetActiveSales — only genuinely on-sale, in-stock items, optionally scoped by category');
{
  const scoped = getActiveSalesTool('Dress');
  const scopedIds = scoped.items.map((i) => i.itemId);
  assert(scopedIds.includes('K-DRS-01'), 'scoped sale search finds the on-sale dress');
  assert(
    scoped.items.every((i) => i.category === 'Dress'),
    'category scoping actually filters',
  );

  const all = getActiveSalesTool();
  assert(
    all.items.every((i) => i.itemId !== 'K-CO-02'),
    'a discontinued item is never listed as an active sale even if flagged on sale',
  );
}

console.log('\nremoveCartItem — drops one line from a multi-item cart, checkout prices the REDUCED value (CART-002)');
{
  let list = [...carts];
  const before = list.find((c) => c.cartId === 'CART-002')!;
  assert(before.items.length === 2, 'sanity: CART-002 starts with two items');
  assert(amountPaidForCart(before) === 3299 + 1299, 'sanity: original combined value is co-ord + top');

  const removed = removeCartItemTool(list, 'CART-002', 'K-TOP-01');
  assert(removed.output.success === true, 'removes the top, keeping the co-ord set');
  assert(removed.output.newCartValue === 3299, 'reports the REDUCED value (co-ord set only), not the original combined total');
  list = list.map((c) => (c.cartId === 'CART-002' ? (removed.cart as (typeof list)[number]) : c));

  const shrunk = list.find((c) => c.cartId === 'CART-002')!;
  assert(shrunk.items.length === 1 && shrunk.items[0].itemId === 'K-CO-01', 'cart.items actually shrank to just the co-ord set');
  assert(amountPaidForCart(shrunk) === 3299, 'derived amount now reflects the REDUCED cart, not the original ₹4598');

  const checkout = createCheckoutLinkTool(list, 'CART-002', CHECKOUT_BASE_URL);
  assert(checkout.output.success === true, 'checkout succeeds after removal');
  assert(checkout.output.finalAmount === 3299, 'createCheckoutLink prices the CURRENT (post-removal) cart, not the original ₹4598');
}

console.log('\nremoveCartItem — refuses to drop the last remaining item (must use markCartOutcome instead)');
{
  const res = removeCartItemTool(carts, 'CART-001', 'K-KUR-01');
  assert(res.output.success === false, 'refused — would leave zero items');
  assert(res.cart === null, 'no state change on refusal');
}

console.log('\nremoveCartItem — refuses an itemId that is not actually in the cart');
{
  const res = removeCartItemTool(carts, 'CART-002', 'K-SHW-01');
  assert(res.output.success === false, 'refused — that item was never in this cart');
}

console.log('\nremoveCartItem — refuses once a checkout link already exists');
{
  let list = [...carts];
  const link = createCheckoutLinkTool(list, 'CART-002', CHECKOUT_BASE_URL);
  list = list.map((c) => (c.cartId === 'CART-002' ? (link.cart as (typeof list)[number]) : c));
  const res = removeCartItemTool(list, 'CART-002', 'K-TOP-01');
  assert(res.output.success === false, 'refused — items can no longer change after checkout');
}

console.log('\nfindSimilarItems — refuses a missing/invalid maxPrice instead of silently returning an empty list');
{
  const zero = findSimilarItemsTool('K-KUR-01', 0);
  assert(zero.success === false, 'maxPrice 0 (the executor default for a missing argument) is refused, not treated as a real budget');
  const negative = findSimilarItemsTool('K-KUR-01', -500);
  assert(negative.success === false, 'a negative maxPrice is refused');
  const valid = findSimilarItemsTool('K-KUR-01', 1500);
  assert(valid.success === true, 'a genuine positive maxPrice still works normally');
}

console.log('\nfindAlternativesByColour — refuses a missing/empty excludeColour instead of silently matching every colour');
{
  const empty = findAlternativesByColourTool('K-KUR-03', '');
  assert(empty.success === false, 'an empty excludeColour (the executor default for a missing argument) is refused');
  const whitespace = findAlternativesByColourTool('K-KUR-03', '   ');
  assert(whitespace.success === false, 'a whitespace-only excludeColour is refused');
  const valid = findAlternativesByColourTool('K-KUR-03', 'Clay');
  assert(valid.success === true, 'a genuine excludeColour still works normally');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
