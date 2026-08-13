import type { AbandonedCart, CartOutcome, CatalogItem, LlmSettableOutcome } from '../types';
import { catalog, getCatalogItem } from '../data/catalog';
import { getCustomerProfile } from '../data/customers';
import { amountPaidForCart, checkDiscountEligibility, resolveCart } from './pricingPolicy';

/**
 * Pure(ish) tool implementations. Each mirrors one function-calling tool
 * exposed to the LLM (see llmProvider.ts's tool declarations). Every tool
 * takes the current cart list as a plain argument and returns
 * `{ cart, output }` — `cart` is the (possibly updated) cart record for the
 * hook to write back into React state via setCarts, `output` is the plain
 * JSON handed back to the model. No tool mutates anything itself; that
 * mirrors Vastra's tools.ts, where the hook is the only place state
 * actually changes.
 *
 * GUARDS — these are the guarantees a QA engineer can point to; the system
 * prompt tells the model what's *supposed* to happen, but these are what
 * actually stops it when a conversation runs long enough for the model to
 * try something it shouldn't (see llmProvider.ts's ToolExecutorMap comment
 * in Vastra for why "tell it not to" isn't sufficient on its own):
 *  - generateDiscountCode refuses a second call for the same cart
 *  - markCartOutcome refuses to overwrite a terminal outcome — including
 *    opted_out specifically, which is what makes opt-out PERMANENT: once
 *    set, no tool call (not even a customer coming back and buying) can
 *    ever move a cart's outcome away from 'opted_out' again
 *  - createCheckoutLink refuses once the cart is already recovered
 * Each refusal returns `{ success: false, error }`, never a thrown
 * exception — the agent needs a normal tool result it can relay in plain
 * language, not a crash.
 *
 * OPT-OUT IS ONE-DIRECTIONAL, NOT A LOCKOUT — this used to make every tool
 * below refuse outright the moment a cart was opted out, on the reasoning
 * that "no further contact" meant no further anything. That over-corrected:
 * real opt-out (and WhatsApp's own 24-hour service-window model) blocks the
 * BRAND from initiating, not the CUSTOMER from writing in. Nothing in this
 * app ever calls a tool except from inside a reply to a customer message
 * (see useCartRecoveryAgent.ts's sendMessage — there is no timer, poll, or
 * other autonomous path that could re-engage a cart on the brand's own
 * initiative), so by construction, any tool call that runs at all is
 * already customer-initiated. That's what makes it safe for
 * getCartDetails/checkDiscountEligibility/generateDiscountCode/
 * createCheckoutLink to keep working normally on an opted-out cart: they
 * only ever run because the customer just said something. What they must
 * NOT do is change `outcome` away from `'opted_out'` — see
 * markCartOutcomeTool's guard — and createCheckoutLink tags the result as
 * `customerInitiatedRecovery` rather than a normal recovery specifically so
 * the campaign dashboard never attributes it to outbound (see
 * useCartRecoveryAgent.ts's CampaignStats and CartTable.tsx).
 */

function findCart(carts: AbandonedCart[], cartId: string): AbandonedCart | undefined {
  return carts.find((c) => c.cartId.toUpperCase() === cartId.trim().toUpperCase());
}

export interface ToolOutcome<T> {
  /** Updated cart record to write back to state, or null when the cart
   * wasn't found / nothing changed. */
  cart: AbandonedCart | null;
  output: T;
}

// ---------------------------------------------------------------------
// getCartDetails
// ---------------------------------------------------------------------

export interface CartDetailsOutput {
  success: boolean;
  error?: string;
  cartId?: string;
  customerName?: string;
  city?: string;
  outcome?: CartOutcome;
  abandonedMinutesAgo?: number;
  cartValue?: number;
  items?: {
    itemId: string;
    name: string;
    category: string;
    size: string;
    colour: string;
    quantity: number;
    price: number;
    fabric: string;
    onSale: boolean;
    inStock: boolean;
    /** Whether THIS cart's own chosen size is available right now — found
     * live: without this, the model had no tool-backed way to answer "is
     * this in stock in my size" and fabricated a "yes" from the item-level
     * `inStock` flag alone (true even when the customer's specific size
     * isn't). This is what findAlternativesBySize's system-prompt trigger
     * ("when getCartDetails reveals the item is out of stock in the
     * customer's size") actually reads. */
    sizeInStock: boolean;
    /** Every size currently available for this product, regardless of
     * which one is in the cart. */
    availableSizes: string[];
  }[];
  discountOffered?: boolean;
  discountCode?: string;
  discountPercent?: number;
}

export function getCartDetailsTool(carts: AbandonedCart[], cartId: string): ToolOutcome<CartDetailsOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };

  const resolved = resolveCart(cart);
  return {
    cart: null,
    output: {
      success: true,
      cartId: cart.cartId,
      customerName: cart.customerName,
      city: cart.city,
      outcome: cart.outcome,
      abandonedMinutesAgo: Math.round((Date.now() - cart.abandonedAt) / 60000),
      cartValue: resolved.cartValue,
      items: cart.items.map((line) => {
        const product = getCatalogItem(line.itemId);
        const availableSizes = product ? product.sizes.filter((s) => !product.outOfStockSizes.includes(s)) : [];
        return {
          itemId: line.itemId,
          name: product?.name ?? 'Unknown item',
          category: product?.category ?? '',
          size: line.size,
          colour: line.colour,
          quantity: line.quantity,
          price: product?.price ?? 0,
          fabric: product?.fabric ?? '',
          onSale: product?.onSale ?? false,
          inStock: product?.inStock ?? false,
          sizeInStock: availableSizes.includes(line.size),
          availableSizes,
        };
      }),
      discountOffered: cart.discountOffered,
      discountCode: cart.discountCode,
      discountPercent: cart.discountPercent,
    },
  };
}

// ---------------------------------------------------------------------
// checkDiscountEligibility
// ---------------------------------------------------------------------

export interface CheckDiscountEligibilityOutput {
  success: boolean;
  error?: string;
  eligible?: boolean;
  maxDiscountPercent?: number;
  cartValue?: number;
  reasons?: string[];
}

export function checkDiscountEligibilityTool(
  carts: AbandonedCart[],
  cartId: string,
): ToolOutcome<CheckDiscountEligibilityOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };

  const result = checkDiscountEligibility(cart);
  return { cart: null, output: { success: true, ...result } };
}

// ---------------------------------------------------------------------
// generateDiscountCode
// ---------------------------------------------------------------------

export interface GenerateDiscountCodeOutput {
  success: boolean;
  error?: string;
  discountCode?: string;
  discountPercent?: number;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function generateDiscountCodeTool(
  carts: AbandonedCart[],
  cartId: string,
): ToolOutcome<GenerateDiscountCodeOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };

  const eligibility = checkDiscountEligibility(cart);
  if (!eligibility.eligible) {
    return {
      cart: null,
      output: { success: false, error: `Not eligible for a discount: ${eligibility.reasons.join(' ')}` },
    };
  }

  const code = `KORA${eligibility.maxDiscountPercent}-${randomSuffix()}`;
  const updated: AbandonedCart = {
    ...cart,
    discountOffered: true,
    discountPercent: eligibility.maxDiscountPercent,
    discountCode: code,
  };
  return {
    cart: updated,
    output: { success: true, discountCode: code, discountPercent: eligibility.maxDiscountPercent },
  };
}

// ---------------------------------------------------------------------
// findSimilarItems — read-only catalog lookup, no cart state involved.
// ---------------------------------------------------------------------

export interface SimilarItem {
  itemId: string;
  name: string;
  category: string;
  price: number;
  fabric: string;
}

export interface FindSimilarItemsOutput {
  success: boolean;
  error?: string;
  items?: SimilarItem[];
}

export function findSimilarItemsTool(itemId: string, maxPrice: number): FindSimilarItemsOutput {
  const source = getCatalogItem(itemId);
  if (!source) return { success: false, error: 'Item not found in catalog.' };
  // Without this, a missing/invalid maxPrice defaults to 0 via the
  // executor's Number(args.maxPrice ?? 0), which silently returns a
  // "successful" EMPTY items array (nothing is ever <= 0) — indistinguishable
  // from "no cheaper alternative exists," when the real problem was an
  // argument that was never actually given. Same standard
  // findAlternativesByBudgetTool already holds itself to.
  if (!Number.isFinite(maxPrice) || maxPrice <= 0) {
    return { success: false, error: 'A valid maximum price is required.' };
  }

  const matches = catalog
    .filter((p) => p.itemId !== itemId && p.category === source.category && p.inStock && p.price <= maxPrice)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map((p) => ({ itemId: p.itemId, name: p.name, category: p.category, price: p.price, fabric: p.fabric }));

  return { success: true, items: matches };
}

// ---------------------------------------------------------------------
// Smarter alternatives — findAlternativesBySize/ByBudget/ByColour and
// getActiveSales. All four are pure catalog lookups, same shape as
// findSimilarItems above: no side effects, no cart state, and structurally
// unable to invent a product, price, size, or colour — every result is a
// `.filter()`/`.map()` over the same `catalog` array everything else in
// this file reads from. The model can misjudge WHICH tool to call or WHAT
// arguments to pass, but it cannot make any of them return something that
// isn't a real catalog row — see systemPrompt.ts for the "must come from a
// tool result" rule this backs.
// ---------------------------------------------------------------------

export interface CatalogAlternative {
  itemId: string;
  name: string;
  category: string;
  price: number;
  fabric: string;
  colour: string;
  /** Only the sizes actually available right now — outOfStockSizes already
   * filtered out, so the model never has to cross-reference two lists (or
   * forget to) before telling the customer a size is available. */
  availableSizes: string[];
}

function toAlternative(p: CatalogItem): CatalogAlternative {
  return {
    itemId: p.itemId,
    name: p.name,
    category: p.category,
    price: p.price,
    fabric: p.fabric,
    colour: p.colour,
    availableSizes: p.sizes.filter((s) => !p.outOfStockSizes.includes(s)),
  };
}

export interface FindAlternativesBySizeOutput {
  success: boolean;
  error?: string;
  requestedSize?: string;
  items?: CatalogAlternative[];
}

/** For a fit objection, or an item that's out of stock in the customer's
 * size: other items in the same category that are genuinely available in
 * that exact size right now (outOfStockSizes excluded, not just "this
 * product has that size listed"). */
export function findAlternativesBySizeTool(itemId: string, size: string): FindAlternativesBySizeOutput {
  const source = getCatalogItem(itemId);
  if (!source) return { success: false, error: 'Item not found in catalog.' };
  const requestedSize = size.trim();
  if (!requestedSize) return { success: false, error: 'No size given.' };

  const matches = catalog
    .filter(
      (p) =>
        p.itemId !== itemId &&
        p.category === source.category &&
        p.inStock &&
        p.sizes.includes(requestedSize) &&
        !p.outOfStockSizes.includes(requestedSize),
    )
    .sort((a, b) => a.price - b.price)
    .slice(0, 3)
    .map(toAlternative);

  return { success: true, requestedSize, items: matches };
}

export interface FindAlternativesByBudgetOutput {
  success: boolean;
  error?: string;
  maxBudget?: number;
  items?: CatalogAlternative[];
}

/** "Similar, under ₹X" — a customer-stated budget ceiling, same category,
 * cheapest-fits-best ordering isn't assumed: sorted highest-to-lowest under
 * the ceiling so the closest match to what they were already looking at
 * comes first, same convention as findSimilarItems. This only ever reads
 * existing catalog prices — it never discounts anything itself, so it
 * can't be used to route around the margin floor; a budget that can only
 * be hit by discounting the ORIGINAL item still has to go through
 * checkDiscountEligibility/generateDiscountCode like any other discount. */
export function findAlternativesByBudgetTool(itemId: string, maxBudget: number): FindAlternativesByBudgetOutput {
  const source = getCatalogItem(itemId);
  if (!source) return { success: false, error: 'Item not found in catalog.' };
  if (!Number.isFinite(maxBudget) || maxBudget <= 0) {
    return { success: false, error: 'Budget must be a positive amount.' };
  }

  const matches = catalog
    .filter((p) => p.itemId !== itemId && p.category === source.category && p.inStock && p.price <= maxBudget)
    .sort((a, b) => b.price - a.price)
    .slice(0, 3)
    .map(toAlternative);

  return { success: true, maxBudget, items: matches };
}

export interface FindAlternativesByColourOutput {
  success: boolean;
  error?: string;
  excludedColour?: string;
  items?: CatalogAlternative[];
}

/** "Not this colour" — same category, any OTHER colour actually in the
 * catalog, ranked by closeness in price to the original (a colour swap
 * shouldn't also be an unrelated price jump). There are no true colour
 * variants of one SKU in this catalog (see CatalogItem.colour's own doc) —
 * this can only ever surface a different real product, never a fabricated
 * "same item, different colour" variant that doesn't exist. */
export function findAlternativesByColourTool(itemId: string, excludeColour: string): FindAlternativesByColourOutput {
  const source = getCatalogItem(itemId);
  if (!source) return { success: false, error: 'Item not found in catalog.' };
  const excluded = excludeColour.trim().toLowerCase();
  // Without this, a missing/empty excludeColour silently matches "every
  // colour" (nothing ever equals an empty string), returning every in-stock
  // item in the category as if it were a real colour-based result — same
  // class of gap findAlternativesBySizeTool already guards against for an
  // empty size.
  if (!excluded) return { success: false, error: 'No colour given.' };

  const matches = catalog
    .filter((p) => p.itemId !== itemId && p.category === source.category && p.inStock && p.colour.toLowerCase() !== excluded)
    .sort((a, b) => Math.abs(a.price - source.price) - Math.abs(b.price - source.price))
    .slice(0, 3)
    .map(toAlternative);

  return { success: true, excludedColour: excludeColour, items: matches };
}

export interface ActiveSaleItem {
  itemId: string;
  name: string;
  category: string;
  price: number;
  fabric: string;
  colour: string;
}

export interface GetActiveSalesOutput {
  success: boolean;
  items: ActiveSaleItem[];
}

/** Whatever's genuinely on sale right now, optionally scoped to one
 * category. Checked before minting a fresh discount code whenever a price
 * objection comes up: a real sale item costs the brand nothing extra
 * (already marked down), where every generateDiscountCode call cuts into
 * margin — so surfacing an existing sale is the cheaper move whenever one
 * actually fits, and this is how the agent finds out one exists instead of
 * assuming. */
export function getActiveSalesTool(category?: string): GetActiveSalesOutput {
  const wantedCategory = category?.trim().toLowerCase();
  const matches = catalog
    .filter((p) => p.onSale && p.inStock && (!wantedCategory || p.category.toLowerCase() === wantedCategory))
    .map((p) => ({ itemId: p.itemId, name: p.name, category: p.category, price: p.price, fabric: p.fabric, colour: p.colour }));

  return { success: true, items: matches };
}

// ---------------------------------------------------------------------
// createCheckoutLink
// ---------------------------------------------------------------------

export interface CreateCheckoutLinkOutput {
  success: boolean;
  error?: string;
  checkoutLink?: string;
  finalAmount?: number;
}

export function createCheckoutLinkTool(
  carts: AbandonedCart[],
  cartId: string,
  checkoutBaseUrl: string,
  discountCode?: string,
): ToolOutcome<CreateCheckoutLinkOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };
  if (cart.outcome === 'recovered' || cart.outcome === 'checkout_sent') {
    return {
      cart: null,
      output: { success: false, error: `A checkout link already exists for this cart: ${cart.checkoutLink}. Do not create another — resend that same link if asked.` },
    };
  }
  if (cart.customerInitiatedRecovery) {
    return {
      cart: null,
      output: {
        success: false,
        error: `A checkout link already exists for this cart: ${cart.customerInitiatedRecovery.checkoutLink}. Do not create another — resend that same link if asked.`,
      },
    };
  }
  // Deliberately NOT refused for outcome === 'opted_out' otherwise — see
  // the file-level guard comment. Reaching this line at all means the
  // customer sent a message this turn, so a checkout link created for an
  // opted-out cart is always customer-initiated, never brand-initiated
  // re-engagement.

  if (discountCode && discountCode !== cart.discountCode) {
    return { cart: null, output: { success: false, error: 'That discount code does not match this cart.' } };
  }

  // The ONLY place a checkout link is ever built — see BrandConfig's own
  // doc for why the base URL is a config value, not a literal here.
  const checkoutLink = `${checkoutBaseUrl}/${cart.cartId}${discountCode ? `?code=${discountCode}` : ''}`;

  // Sending a link is intent, not a sale — see CartOutcome's own doc.
  // 'active' -> 'checkout_sent' here; only the dashboard's "Mark as paid"
  // control (markCartPaidTool) ever moves a cart to 'recovered'. Outcome
  // stays 'opted_out' on that path instead (permanent, per
  // markCartOutcomeTool's guard) — customerInitiatedRecovery.paid carries
  // the same pending/paid distinction there, since outcome itself can't.
  const updated: AbandonedCart = {
    ...cart,
    checkoutLink,
    outcome: cart.outcome === 'opted_out' ? cart.outcome : 'checkout_sent',
    // A one-time fact, not a stored total — see AbandonedCart's own doc.
    // finalAmount below is derived from THIS updated cart (current items +
    // this flag), never cached.
    checkoutDiscountApplied: Boolean(discountCode),
    ...(cart.outcome === 'opted_out' ? { customerInitiatedRecovery: { checkoutLink, paid: false } } : {}),
  };
  const finalAmount = amountPaidForCart(updated);
  return { cart: updated, output: { success: true, checkoutLink, finalAmount } };
}

// ---------------------------------------------------------------------
// selectAlternative — swaps the cart's line item to one of the real
// alternatives previously surfaced by an alternative-finding tool. Without
// this, "the customer picked option 2" had nowhere to actually land: the
// cart's own items array never changed, so createCheckoutLink kept pricing
// (and the dashboard kept crediting) the ORIGINAL item even after the
// customer chose something else entirely — found live on CART-008, where a
// ₹2799 alternative was accepted but checkout/dashboard both still showed
// ₹4999. Refuses once a checkout link already exists for the same reason
// generateDiscountCode/createCheckoutLink refuse post-recovery: nothing
// should be able to change what a cart contains after it's already been
// checked out against.
// ---------------------------------------------------------------------

export interface SelectAlternativeOutput {
  success: boolean;
  error?: string;
  itemId?: string;
  name?: string;
  price?: number;
  size?: string;
  colour?: string;
}

export function selectAlternativeTool(
  carts: AbandonedCart[],
  cartId: string,
  itemId: string,
): ToolOutcome<SelectAlternativeOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };
  if (cart.checkoutLink || cart.outcome === 'recovered') {
    return { cart: null, output: { success: false, error: 'A checkout link already exists for this cart — the item can no longer be changed.' } };
  }

  const product = getCatalogItem(itemId);
  if (!product) return { cart: null, output: { success: false, error: 'Item not found in catalog.' } };
  if (!product.inStock) return { cart: null, output: { success: false, error: 'That item is currently out of stock.' } };

  const availableSizes = product.sizes.filter((s) => !product.outOfStockSizes.includes(s));
  const existingSize = cart.items[0]?.size;
  const size = existingSize && availableSizes.includes(existingSize) ? existingSize : availableSizes[0];
  if (!size) return { cart: null, output: { success: false, error: 'That item has no sizes currently in stock.' } };

  const quantity = cart.items[0]?.quantity ?? 1;
  const updated: AbandonedCart = {
    ...cart,
    items: [{ itemId: product.itemId, size, colour: product.colour, quantity }],
    // A discount minted for the OLD item was computed against ITS margin —
    // never valid for a different product, so it's cleared rather than
    // silently carried over onto the new item's price.
    discountOffered: false,
    discountPercent: undefined,
    discountCode: undefined,
  };
  return {
    cart: updated,
    output: { success: true, itemId: product.itemId, name: product.name, price: product.price, size, colour: product.colour },
  };
}

// ---------------------------------------------------------------------
// removeCartItem — drops ONE line from a multi-item cart when the customer
// only wants part of what's in it (e.g. "just the co-ord set, not the
// top" on CART-002's two-item cart). Same reasoning as selectAlternative's
// own doc: without this, the cart's `items` array never actually changes,
// so createCheckoutLink/resolveCart keep pricing (and the dashboard keeps
// crediting) the FULL original cart even after the customer said they only
// want part of it. Because amountPaidForCart/resolveCart always derive
// fresh from `cart.items` (never a stored total), updating `items` here is
// the ENTIRE fix — checkout, revenue attribution, and the dashboard's cart
// value all pick up the reduced set automatically, no separate figure to
// keep in sync.
// ---------------------------------------------------------------------

export interface RemoveCartItemOutput {
  success: boolean;
  error?: string;
  removedItemId?: string;
  removedName?: string;
  remainingItems?: { itemId: string; name: string; size: string; colour: string; quantity: number }[];
  newCartValue?: number;
}

export function removeCartItemTool(
  carts: AbandonedCart[],
  cartId: string,
  itemId: string,
): ToolOutcome<RemoveCartItemOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };
  if (cart.checkoutLink || cart.outcome === 'recovered' || cart.outcome === 'checkout_sent') {
    return { cart: null, output: { success: false, error: 'A checkout link already exists for this cart — items can no longer be changed.' } };
  }

  const line = cart.items.find((l) => l.itemId === itemId);
  if (!line) {
    return { cart: null, output: { success: false, error: `Item ${itemId} is not in this cart — nothing to remove.` } };
  }
  // A cart must always end up with at least one line — dropping the last
  // one isn't "a smaller cart," it's "no sale," which is markCartOutcome's
  // job (see systemPrompt.ts's multi-item rule), not this tool's.
  if (cart.items.length <= 1) {
    return {
      cart: null,
      output: {
        success: false,
        error: 'This cart only has one item left — removing it would leave nothing to check out. If the customer wants none of it, use markCartOutcome("lost") instead.',
      },
    };
  }

  const remainingLines = cart.items.filter((l) => l.itemId !== itemId);
  const updated: AbandonedCart = {
    ...cart,
    items: remainingLines,
    // Same reasoning as selectAlternativeTool: a discount minted against
    // the FULL cart's value is no longer valid once the cart shrinks.
    discountOffered: false,
    discountPercent: undefined,
    discountCode: undefined,
  };
  const removedProduct = getCatalogItem(itemId);
  const resolved = resolveCart(updated);
  return {
    cart: updated,
    output: {
      success: true,
      removedItemId: itemId,
      removedName: removedProduct?.name ?? itemId,
      remainingItems: remainingLines.map((l) => {
        const p = getCatalogItem(l.itemId);
        return { itemId: l.itemId, name: p?.name ?? 'Unknown item', size: l.size, colour: l.colour, quantity: l.quantity };
      }),
      newCartValue: resolved.cartValue,
    },
  };
}

// ---------------------------------------------------------------------
// getRecommendationsFromHistory — Trigger 1 (recommendations; a
// replenishment trigger was built and then deliberately removed — fashion
// isn't a consumables vertical, see types.ts's CampaignType doc — so
// numbering here starts at 1, not 2). Read-only,
// same "structurally unable to invent a product" guarantee as
// findSimilarItems/findAlternativesBy*: every result is a `.filter()` over
// the real `catalog`, gated on real purchase history from
// data/customers.ts. Returns `items` (not `recommendations`) deliberately
// — same field name findSimilarItems/getActiveSales/etc use, so
// useCartRecoveryAgent.ts's existing ALTERNATIVE_TOOLS handling (pendingOptions,
// presented-before-selectable, selectAlternative reuse) picks this tool up
// for free, no new state-machine code required.
// ---------------------------------------------------------------------

/** Which categories a purchase in the key category genuinely complements —
 * deliberately narrow and hand-curated (not "everything in stock"), so a
 * recommendation always has an honest "why" a reply can state, not just a
 * coincidental price match. */
const COMPLEMENTARY_CATEGORIES: Record<string, string[]> = {
  Kurta: ['Trousers', 'Accessory'],
  Top: ['Trousers', 'Accessory'],
  Trousers: ['Top', 'Kurta'],
  Dress: ['Accessory'],
  Saree: ['Accessory'],
  'Co-ord Set': ['Accessory'],
  Occasion: ['Accessory'],
  Innerwear: [],
  Accessory: [],
};

export interface RecommendationItem {
  itemId: string;
  name: string;
  category: string;
  price: number;
  fabric: string;
  colour: string;
  /** The real past purchase this recommendation is grounded in — lets a
   * reply honestly say "since you got the X…" instead of presenting the
   * suggestion as coming from nowhere. */
  becauseOf: string;
}

export interface GetRecommendationsFromHistoryOutput {
  success: boolean;
  items: RecommendationItem[];
}

/**
 * GUARDS, all enforced here rather than left to the model:
 *  - every candidate comes from the real `catalog` array, filtered against
 *    a real PurchaseRecord — nothing here is ever invented.
 *  - never recommends an item the customer already owns (ownedItemIds).
 *  - never exceeds `typicalSpend.max` — the explicit "don't push a ₹12,999
 *    piece at someone who buys ₹1,500 items" rule.
 *  - filtered to `sizeProfile` when a size is known for that category, AND
 *    that size must genuinely be in stock (not just listed) — same
 *    standard findAlternativesBySize already holds itself to.
 *  - only same-category or explicitly complementary-category items ever
 *    qualify (COMPLEMENTARY_CATEGORIES) — "genuinely complement or follow
 *    from" is enforced structurally, not left to the model's judgment.
 * No purchase history at all returns success with an empty list — nothing
 * to recommend, not a failure (see data/customers.ts's Naomi Fernandes).
 */
export function getRecommendationsFromHistoryTool(customerId: string): GetRecommendationsFromHistoryOutput {
  const profile = getCustomerProfile(customerId);
  if (!profile || profile.purchaseHistory.length === 0) return { success: true, items: [] };

  const ownedItemIds = new Set(profile.purchaseHistory.map((p) => p.itemId));
  const seen = new Set<string>();
  const items: RecommendationItem[] = [];

  const purchasesByRecency = [...profile.purchaseHistory].sort((a, b) => b.purchaseDate - a.purchaseDate);
  for (const purchase of purchasesByRecency) {
    const source = getCatalogItem(purchase.itemId);
    if (!source) continue;

    const candidates = catalog.filter((p) => {
      if (p.itemId === source.itemId || ownedItemIds.has(p.itemId) || seen.has(p.itemId)) return false;
      if (!p.inStock || p.price > profile.typicalSpend.max) return false;
      const sameOrComplementary = p.category === source.category || (COMPLEMENTARY_CATEGORIES[source.category] ?? []).includes(p.category);
      if (!sameOrComplementary) return false;
      const knownSize = profile.sizeProfile[p.category];
      if (knownSize && (!p.sizes.includes(knownSize) || p.outOfStockSizes.includes(knownSize))) return false;
      return true;
    });

    for (const c of candidates.slice(0, 2)) {
      items.push({ itemId: c.itemId, name: c.name, category: c.category, price: c.price, fabric: c.fabric, colour: c.colour, becauseOf: source.name });
      seen.add(c.itemId);
    }
    if (items.length >= 3) break;
  }

  return { success: true, items: items.slice(0, 3) };
}

// ---------------------------------------------------------------------
// getBrowseAbandonment — Trigger 2 (browse-and-abandon). Read-only, same
// real-data-only guarantee as everything above; every result traces back
// to a real BrowseEvent in data/customers.ts.
// ---------------------------------------------------------------------

/** Fewer than this many views isn't a pattern worth reaching out about. */
const BROWSE_VIEW_THRESHOLD = 3;
/** Minimum days since the last view before a nudge is offered — the
 * "cooling-off period so it isn't creepy" the trigger explicitly asks for:
 * reaching out the moment someone looks at something reads as active
 * surveillance, not a helpful nudge. */
const BROWSE_COOLING_OFF_DAYS = 2;
/** Beyond this many days the interest itself is presumed stale — an old
 * browse streak isn't still "abandonment" months later. */
const BROWSE_STALE_DAYS = 30;

export interface BrowseAbandonmentItem {
  itemId: string;
  name: string;
  category: string;
  price: number;
  colour: string;
  viewCount: number;
  daysSinceLastView: number;
}

export interface GetBrowseAbandonmentOutput {
  success: boolean;
  items: BrowseAbandonmentItem[];
}

/**
 * GUARDS, all enforced here rather than left to the model:
 *  - `converted` browse events (this exact viewing streak already ended in
 *    a purchase) are excluded outright.
 *  - any item that appears ANYWHERE in this customer's purchase history is
 *    excluded too — a real sale, even one this specific BrowseEvent wasn't
 *    marked as causing, is never treated as an open abandonment.
 *  - any item currently sitting in one of this customer's OTHER carts with
 *    a still-open outcome ('active' or 'checkout_sent') is excluded — "not
 *    in an active cart" per the trigger's own rule; `allCarts` is passed
 *    in specifically so this can check across EVERY campaign thread for
 *    this customer, not just the one this tool call happens to be running
 *    inside.
 *  - fewer than BROWSE_VIEW_THRESHOLD views, or a last view inside the
 *    cooling-off window, or one old enough to be stale, are all excluded.
 * Opt-out itself is deliberately NOT checked here — see tools.ts's
 * file-level guard comment: any tool call at all only ever happens inside
 * a reply to a message the customer just sent, so it's already
 * customer-initiated by construction: the same reasoning that lets
 * getCartDetails/checkDiscountEligibility keep working normally on an
 * opted-out cart-recovery thread applies unchanged here.
 */
export function getBrowseAbandonmentTool(customerId: string, allCarts: AbandonedCart[]): GetBrowseAbandonmentOutput {
  const profile = getCustomerProfile(customerId);
  if (!profile) return { success: true, items: [] };

  const purchasedItemIds = new Set(profile.purchaseHistory.map((p) => p.itemId));
  // Scoped to campaignType === 'cart_recovery' specifically — that's the
  // only campaign type where `items` means "the customer genuinely put
  // this in a cart." The other three types (including a browse-abandonment
  // thread's own thread about THIS item) merely propose an item; without
  // this scoping, a browse-abandonment cart's own seeded item excluded
  // itself from its own guard the moment this tool ran against it — found
  // live via scripts/verifyCampaignTriggers.ts, Meher Khanna's CART-106.
  const inOpenCartItemIds = new Set(
    allCarts
      .filter(
        (c) =>
          c.customerId === customerId &&
          c.campaignType === 'cart_recovery' &&
          (c.outcome === 'active' || c.outcome === 'checkout_sent'),
      )
      .flatMap((c) => c.items.map((i) => i.itemId)),
  );

  const now = Date.now();
  const items: BrowseAbandonmentItem[] = [];
  for (const ev of profile.browseEvents) {
    if (ev.converted) continue;
    if (ev.viewCount < BROWSE_VIEW_THRESHOLD) continue;
    if (purchasedItemIds.has(ev.itemId)) continue;
    if (inOpenCartItemIds.has(ev.itemId)) continue;
    const daysSinceLastView = Math.floor((now - ev.timestamp) / 86_400_000);
    if (daysSinceLastView < BROWSE_COOLING_OFF_DAYS || daysSinceLastView > BROWSE_STALE_DAYS) continue;
    const product = getCatalogItem(ev.itemId);
    if (!product || !product.inStock) continue;
    items.push({
      itemId: product.itemId,
      name: product.name,
      category: product.category,
      price: product.price,
      colour: product.colour,
      viewCount: ev.viewCount,
      daysSinceLastView,
    });
  }
  return { success: true, items };
}

// ---------------------------------------------------------------------
// markCartOutcome
// ---------------------------------------------------------------------

export interface MarkCartOutcomeOutput {
  success: boolean;
  error?: string;
  outcome?: CartOutcome;
}

/**
 * `outcome` is deliberately typed LlmSettableOutcome, not the full
 * CartOutcome — 'recovered' isn't among the values the LLM can ever pass
 * here at the TYPE level, not just refused at runtime. See CartOutcome's
 * own doc: a chat transcript is never proof of payment, so the only path
 * to 'recovered' is the dashboard's "Mark as paid" control
 * (markCartPaidTool, below) confirming an actual payment. 'checkout_sent'
 * is likewise not settable here — createCheckoutLinkTool sets it directly
 * as the automatic result of a link actually being created, not as a
 * separate step the model has to remember to call.
 */
export function markCartOutcomeTool(
  carts: AbandonedCart[],
  cartId: string,
  outcome: LlmSettableOutcome,
  reason?: string,
): ToolOutcome<MarkCartOutcomeOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };

  if (cart.outcome !== 'active') {
    return {
      cart: null,
      output: {
        success: false,
        error: `This cart already has an outcome (${cart.outcome}) and cannot be changed. Do not call markCartOutcome again for ${cart.cartId}.`,
      },
    };
  }

  const updated: AbandonedCart = {
    ...cart,
    outcome,
    lostReason: reason,
  };
  return { cart: updated, output: { success: true, outcome } };
}

// ---------------------------------------------------------------------
// markCartPaid — NOT an LLM tool. Deliberately absent from
// llmProvider.ts's tool declarations and useCartRecoveryAgent.ts's
// ToolExecutorMap; a chat transcript can never be proof of payment, so
// this only exists to back the dashboard's demo-only "Mark as paid"
// control (CartTable.tsx), called directly from
// useCartRecoveryAgent.ts's markPaid. Same shape as every other tool here
// (ToolOutcome<T>, pure, no self-mutation) purely for consistency with the
// rest of this file — being pure and cart-list-in/cart-out is a useful
// property regardless of who's allowed to call it.
// ---------------------------------------------------------------------

export interface MarkCartPaidOutput {
  success: boolean;
  error?: string;
  outcome?: CartOutcome;
}

export function markCartPaidTool(carts: AbandonedCart[], cartId: string): ToolOutcome<MarkCartPaidOutput> {
  const cart = findCart(carts, cartId);
  if (!cart) return { cart: null, output: { success: false, error: 'Cart not found.' } };

  if (cart.outcome === 'checkout_sent') {
    return { cart: { ...cart, outcome: 'recovered' }, output: { success: true, outcome: 'recovered' } };
  }
  if (cart.customerInitiatedRecovery && !cart.customerInitiatedRecovery.paid) {
    return {
      cart: { ...cart, customerInitiatedRecovery: { ...cart.customerInitiatedRecovery, paid: true } },
      output: { success: true, outcome: cart.outcome },
    };
  }
  return {
    cart: null,
    output: { success: false, error: `Cart ${cart.cartId} is not awaiting payment (current status: ${cart.outcome}).` },
  };
}
