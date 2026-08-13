// Shared domain types for the cart-recovery agent demo.

/** One product the brand sells. `marginPercent` and `onSale` feed
 * src/lib/pricingPolicy.ts directly — the discount engine reasons about
 * catalog data, never about anything the model says. `sizes`/`colour`/
 * `outOfStockSizes` back the smarter-recommendation tools (findAlternativesBySize,
 * findAlternativesByColour) — every alternative those tools can ever return
 * is a real row here, never invented by the model (see tools.ts). */
export interface CatalogItem {
  itemId: string;
  name: string;
  category: string;
  price: number; // INR
  fabric: string;
  onSale: boolean;
  /** Gross margin at full price, as a percentage. Used to enforce the
   * margin floor in pricingPolicy.ts — a discount can shrink margin but
   * never past the floor, regardless of what the tier cap would allow. */
  marginPercent: number;
  /** Whether this product is orderable AT ALL. False only when every size
   * is out of stock (see outOfStockSizes) — kept as its own flag rather
   * than derived, since a couple of seed items are discontinued outright
   * rather than merely low on one size. */
  inStock: boolean;
  imageUrl: string;
  /** This product's colourway. One colour per catalog entry (no true SKU
   * colour-variants modeled) — "same item, other colours" is answered by
   * findAlternativesByColour searching for OTHER catalog entries in the
   * same category with a different `colour`, never a variant that doesn't
   * actually exist in the catalog. */
  colour: string;
  /** Every size this product comes in. */
  sizes: string[];
  /** Subset of `sizes` currently unavailable — a product can be `inStock:
   * true` overall while still being sold out in one particular size. */
  outOfStockSizes: string[];
}

export interface CartLineItem {
  itemId: string; // references CatalogItem.itemId
  size: string;
  colour: string;
  quantity: number;
}

/**
 * 'checkout_sent' is a distinct, non-terminal-from-revenue's-perspective
 * state: a checkout link exists, but nobody has paid yet — sending a link
 * is intent, not a sale. Only a confirmed payment (the dashboard's "Mark
 * as paid" control — see useCartRecoveryAgent.ts's markPaid, tools.ts's
 * markCartPaidTool) can move a cart to 'recovered'. The LLM itself can
 * never set 'recovered' — markCartOutcomeTool's accepted values
 * deliberately exclude it (see LlmSettableOutcome) — because a chat
 * transcript can never be proof of payment. Found live: a customer said
 * "ok", got a checkout link, and the cart was immediately marked Recovered
 * with the full amount counted as revenue — nobody had actually paid.
 */
export type CartOutcome = 'active' | 'checkout_sent' | 'recovered' | 'lost' | 'opted_out';

/** The only outcomes the LLM's markCartOutcome tool may ever set — see
 * CartOutcome's own doc for why 'recovered' isn't among them. */
export type LlmSettableOutcome = 'lost' | 'opted_out';

/**
 * Which campaign produced this conversation thread. 'cart_recovery' is the
 * original (and only implicit) type every pre-existing seeded cart carries.
 * The other two are the newer profile-driven triggers — see
 * data/customers.ts and tools.ts's getRecommendationsFromHistory/
 * getBrowseAbandonment. Deliberately a tag on the SAME AbandonedCart shape
 * rather than a parallel type: every trigger here reduces to "one seeded
 * outbound WhatsApp thread about one real catalog item, with the same
 * intent -> checkout-link -> paid state machine underneath" (see
 * CartOutcome), so reusing the existing provider-fallback/fact-tracking/
 * guardrail/pricing infrastructure as-is is both less code and a genuine
 * architectural fit, not a shortcut.
 *
 * A 'replenishment' trigger (repeat-purchase nudges for everyday basics)
 * was built and then deliberately removed — fashion isn't a consumables
 * vertical, and a "you're due for a reorder" nudge fit Kora's own catalog
 * far more awkwardly than the other two triggers. See the README's Design
 * decisions for the fuller note.
 */
export type CampaignType = 'cart_recovery' | 'recommendation' | 'browse_abandonment';

export interface AbandonedCart {
  cartId: string;
  /** Defaults to 'cart_recovery' for every pre-existing seeded cart — see
   * CampaignType's own doc. */
  campaignType: CampaignType;
  /** Joins this thread to a data/customers.ts CustomerProfile — always the
   * same value as `phone` below (customers are looked up by phone in this
   * demo), kept as its own named field so tools.ts's new profile-driven
   * tools don't have to reach for `.phone` and rediscover that convention
   * on their own. */
  customerId: string;
  customerName: string;
  phone: string;
  city: string;
  items: CartLineItem[];
  abandonedAt: number; // epoch ms
  /** Authored, not LLM-generated — see systemPrompt.ts header for why the
   * opening nudge is deterministic content while objection handling isn't. */
  openingMessage: string;
  outcome: CartOutcome;
  lostReason?: string;
  discountOffered: boolean;
  discountPercent?: number;
  discountCode?: string;
  checkoutLink?: string;
  /** True once createCheckoutLink actually applied `discountCode` to this
   * checkout (the customer accepted it, not merely that one was generated
   * at some point). A one-time fact recorded at checkout and never mutated
   * again — deliberately NOT paired with a stored dollar total. The amount
   * actually paid is always computed fresh from resolveCart(cart) (this
   * cart's CURRENT items) and this flag — see pricingPolicy.ts's
   * amountPaidForCart — specifically so a later item swap (selectAlternativeTool)
   * can never leave a stale total sitting in state. This is the fix for a
   * bug found live: a cart's revenue was recorded once at checkout time
   * off the ORIGINAL item, then the customer picked a cheaper alternative
   * mid-conversation with no tool to actually swap the cart — the stored
   * total silently went stale, overstating revenue recovered by the full
   * original-vs-alternative price gap. */
  checkoutDiscountApplied?: boolean;
  /**
   * Set when a cart that's marked `opted_out` is nonetheless purchased
   * because the CUSTOMER messaged back in on their own — never because the
   * brand re-engaged (see tools.ts's createCheckoutLinkTool and
   * systemPrompt.ts's opt-out rule; the brand has no way to initiate
   * contact with an opted-out cart at all). Deliberately kept separate
   * from `outcome`: `outcome` stays `'opted_out'` permanently once set
   * (see markCartOutcomeTool's guard, which blocks every further outcome
   * change including this one) — a marketing-consent withdrawal doesn't
   * get silently reclassified as a normal recovered cart just because a
   * sale happened, and this revenue must never count toward the
   * campaign-attributed `revenueRecovered` KPI, the recovery funnel, or
   * the recovery rate, since no outbound message prompted it. Just a
   * marker, not a stored amount — see amountPaidForCart, same reasoning as
   * checkoutDiscountApplied above.
   */
  customerInitiatedRecovery?: {
    checkoutLink: string;
    /** Same "intent isn't a sale" distinction as the main outcome/
     * checkout_sent split above, for the one path where `outcome` itself
     * can't carry it (opted_out is permanent — see markCartOutcomeTool's
     * guard). False the moment the link is created; only the dashboard's
     * "Mark as paid" control ever sets this true. */
    paid: boolean;
  };
}

/** A real catalog product, reduced to what a WhatsApp media-message bubble
 * needs to render — see lib/productImages.ts's productImageFor, the ONLY
 * place one of these is ever constructed. Always built from a real
 * data/catalog.ts entry; never something a ChatMessage author (LLM or
 * otherwise) supplies free-text, so a message can never claim to show a
 * product image that isn't real. */
export interface ProductImage {
  itemId: string;
  name: string;
  price: number;
  imageUrl: string;
  /** A real, code-computed link to this product's own page — see
   * lib/productImages.ts's productImageFor, the only place this is ever
   * built (from BrandConfig's productBaseUrl + the real itemId). Never
   * something the model states in text. */
  productUrl: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: number;
  /** Present only on a message that IS a product presentation — a real
   * catalog item's picture, rendered as its own WhatsApp media bubble (see
   * ChatBubble.tsx). Attached entirely in code from an actual tool result
   * this turn (see useCartRecoveryAgent.ts's sendMessage), never inferred
   * from the LLM's reply text — the model has no way to attach or
   * fabricate one. */
  image?: ProductImage;
}
