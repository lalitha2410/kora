/**
 * Customer profile layer backing the two profile-driven campaign triggers
 * (recommendations, browse-abandonment — see tools.ts's
 * getRecommendationsFromHistory/getBrowseAbandonment). Kept as its own
 * data module, same reasoning as data/catalog.ts vs data/carts.ts: a
 * customer's real purchase/browse history is reference data the tools
 * read, never something a tool mutates or the model invents.
 *
 * A replenishment trigger (repeat-purchase nudges for everyday basics) was
 * built against this same profile shape and then deliberately removed —
 * fashion isn't a consumables vertical, see the README's Design decisions.
 * `purchaseHistory`/`browseEvents` stayed exactly as they were; only the
 * customers who existed purely to exercise replenishment-specific guards
 * were dropped.
 *
 * `customerId` is always the same value as a cart's `phone` — see
 * AbandonedCart.customerId's own doc — so this file's profiles join to
 * data/carts.ts's threads by phone number, the one identifier both files
 * already had a reason to carry.
 */

export interface PurchaseRecord {
  itemId: string; // references CatalogItem.itemId
  size: string;
  colour: string;
  quantity: number;
  pricePaid: number; // INR, what was actually paid — not necessarily catalog.price if bought during a sale
  purchaseDate: number; // epoch ms
}

export interface BrowseEvent {
  itemId: string; // references CatalogItem.itemId
  timestamp: number; // epoch ms of the most recent view in this viewing streak
  viewCount: number;
  /** True once this browse eventually led to a purchase of the SAME item —
   * read by getBrowseAbandonmentTool to exclude it: a repeat-view item the
   * customer already bought isn't an abandonment, it's a completed sale. */
  converted: boolean;
}

export interface CustomerProfile {
  customerId: string; // == AbandonedCart.customerId / .phone
  name: string;
  purchaseHistory: PurchaseRecord[];
  /** The size this customer actually buys, per catalog category — e.g.
   * { Kurta: 'M', Trousers: '32' }. Missing categories mean no evidence
   * either way; getRecommendationsFromHistoryTool skips a category it has
   * no size evidence for rather than guessing. */
  sizeProfile: Record<string, string>;
  /** This customer's usual price band, INR — read by
   * getRecommendationsFromHistoryTool so a recommendation never reaches
   * far outside what this customer actually tends to spend (e.g. never
   * surfacing a ₹12,999 occasion piece to someone who buys ₹1,500 items). */
  typicalSpend: { min: number; max: number };
  browseEvents: BrowseEvent[];
}

function daysAgo(n: number): number {
  return Date.now() - n * 24 * 60 * 60 * 1000;
}

/**
 * Seven profiles: the "no history at all" edge case, plus two customers
 * each for the recommendation and browse-abandonment triggers (accept +
 * decline scenarios), plus two guard-specific profiles for
 * getBrowseAbandonmentTool's "already bought" and "already in an active
 * cart" exclusions.
 */
export const customers: CustomerProfile[] = [
  {
    // EDGE CASE: no history at all — every profile-driven tool must
    // degrade gracefully (empty/ineligible results, never an error) for a
    // customer this thin.
    customerId: '9845099006',
    name: 'Naomi Fernandes',
    purchaseHistory: [],
    sizeProfile: {},
    typicalSpend: { min: 0, max: 0 },
    browseEvents: [],
  },
  {
    // EDGE CASE: browsed the same item 3+ times, never bought, never
    // added to cart.
    customerId: '9845099005',
    name: 'Meher Khanna',
    purchaseHistory: [],
    sizeProfile: { Dress: 'M' },
    typicalSpend: { min: 1500, max: 3500 },
    browseEvents: [{ itemId: 'K-DRS-01', timestamp: daysAgo(4), viewCount: 4, converted: false }],
  },
  {
    // Recommendation candidate — a real prior purchase with a genuine
    // complementary item available in her own size/spend band. Also the
    // "don't push a ₹12,999 piece at someone who buys ₹1,500 items" test:
    // her typicalSpend ceiling (2200) excludes K-SET-01 entirely.
    customerId: '9845099007',
    name: 'Diya Kapoor',
    purchaseHistory: [
      { itemId: 'K-KUR-01', size: 'M', colour: 'Undyed Natural', quantity: 1, pricePaid: 1849, purchaseDate: daysAgo(40) },
    ],
    sizeProfile: { Kurta: 'M', Trousers: '32', Top: 'M' },
    typicalSpend: { min: 1000, max: 2200 },
    browseEvents: [],
  },
  {
    // Recommendation decline scenario — same shape as Diya, different
    // customer so the accept/decline scenarios never touch the same
    // conversation.
    customerId: '9845099008',
    name: 'Farah Qureshi',
    purchaseHistory: [
      { itemId: 'K-TOP-02', size: 'M', colour: 'Undyed Natural', quantity: 1, pricePaid: 699, purchaseDate: daysAgo(30) },
    ],
    sizeProfile: { Top: 'M', Trousers: '30' },
    typicalSpend: { min: 500, max: 1500 },
    browseEvents: [],
  },
  {
    // Browse-abandonment decline scenario counterpart to Meher.
    customerId: '9845099009',
    name: 'Ira Sethi',
    purchaseHistory: [],
    sizeProfile: { Saree: 'Free Size' },
    typicalSpend: { min: 3000, max: 7000 },
    browseEvents: [{ itemId: 'K-SAR-02', timestamp: daysAgo(5), viewCount: 4, converted: false }],
  },
  {
    // GUARD: viewed 3+ times AND later bought the same item —
    // getBrowseAbandonmentTool must exclude it (converted: true / already
    // purchased), never treat a completed sale as an open abandonment.
    customerId: '9845099010',
    name: 'Sana Iyer',
    purchaseHistory: [
      { itemId: 'K-CO-01', size: 'S', colour: 'Undyed Natural', quantity: 1, pricePaid: 3299, purchaseDate: daysAgo(14) },
    ],
    sizeProfile: { 'Co-ord Set': 'S' },
    typicalSpend: { min: 2500, max: 4000 },
    browseEvents: [{ itemId: 'K-CO-01', timestamp: daysAgo(20), viewCount: 5, converted: true }],
  },
  {
    // GUARD: viewed 3+ times an item that's sitting in one of THIS
    // customer's own OTHER carts right now (CART-014, cart_recovery,
    // still active) — getBrowseAbandonmentTool must exclude it: the
    // customer already has this exact item in an active cart, so a
    // separate browse-abandonment nudge about it would be redundant (and
    // is exactly the "not in an active cart" guard the tool has to
    // enforce). customerId matches Karan Mehra's phone in data/carts.ts —
    // reusing an existing cart-recovery customer here on purpose, so this
    // guard is checked against a REAL cross-campaign cart, not a
    // hypothetical one.
    customerId: '9845144567',
    name: 'Karan Mehra',
    purchaseHistory: [],
    sizeProfile: { Kurta: 'L' },
    typicalSpend: { min: 1000, max: 2500 },
    browseEvents: [{ itemId: 'K-KUR-01', timestamp: daysAgo(2), viewCount: 3, converted: false }],
  },
];

export function getCustomerProfile(customerId: string): CustomerProfile | undefined {
  return customers.find((c) => c.customerId === customerId);
}
