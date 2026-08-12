export interface Scenario {
  id: string;
  label: string;
  cartId: string;
  /** Sent one at a time, each awaiting the agent's reply before the next
   * goes out — lets a live demo run the whole exchange without typing. */
  customerTurns: string[];
}

/**
 * Sixteen scripted paths for "Play scenario," each pinned to a specific
 * seeded cart so the outcome is deterministic (see data/carts.ts for why
 * each cart was picked — margin floor, on-sale flag, recency, size/colour/
 * budget setup, etc). Four exercise the smarter-alternative tools
 * (findAlternativesBySize/ByBudget/ByColour, getActiveSales) added
 * alongside the multi-provider/context-window hardening; one exercises the
 * directional opt-out fix — a cart that opts out and then messages back in
 * on its own, on a DIFFERENT cart than the plain opt_out scenario above so
 * the two never interact; one exercises removeCartItem on CART-002 (the
 * only multi-item cart in the seed data), keeping just one of its two
 * items and confirming checkout prices the REDUCED cart, not the original
 * combined value.
 *
 * The last four cover the two newer campaign triggers (see
 * data/customers.ts, tools.ts's getRecommendationsFromHistory/
 * getBrowseAbandonment), each with both an accept path AND a decline path —
 * the "handle the no" requirement is exercised just as deliberately as the
 * "handle the yes" one for every trigger. (A third trigger, replenishment,
 * was built and then deliberately removed — see types.ts's CampaignType
 * doc — which included its own three scenarios, no longer here.)
 */
export const scenarios: Scenario[] = [
  {
    id: 'price_objection_discount',
    label: 'Price objection → discount',
    cartId: 'CART-001',
    customerTurns: [
      "Hi! Thanks for checking in — honestly the price felt a little high for a kurta, is there any way to get it for less?",
      "Okay that works for me, I'll take it — please send me the checkout link.",
    ],
  },
  {
    id: 'price_objection_alternative',
    label: 'Price objection → cheaper alternative',
    cartId: 'CART-008',
    customerTurns: [
      "Hi, it's lovely but honestly ₹4999 is more than I wanted to spend on this one. Any discount available?",
      "Ah okay, no worries. Is there anything similar but a bit more affordable?",
    ],
  },
  {
    id: 'just_browsing',
    label: 'Just browsing → graceful exit',
    cartId: 'CART-010',
    customerTurns: ["Hey, thanks for checking in — I was just browsing, not really planning to buy right now."],
  },
  {
    id: 'already_purchased',
    label: 'Already purchased → mark lost',
    cartId: 'CART-009',
    customerTurns: ["Hi, actually I ended up buying a similar saree from another store already, sorry!"],
  },
  {
    id: 'on_sale_no_discount',
    label: 'Item on sale → no discount available',
    cartId: 'CART-005',
    customerTurns: ["Hi! Is there any additional discount you can give me on this dress?"],
  },
  {
    id: 'opt_out',
    label: 'Asks to stop messaging → opt out',
    cartId: 'CART-011',
    customerTurns: ["Please stop messaging me, I'm not interested."],
  },
  {
    id: 'sale_aware_surface',
    label: 'Price objection → existing sale surfaced',
    cartId: 'CART-013',
    customerTurns: ["Hi, honestly ₹3499 feels like a lot for this dress, any chance of a discount?"],
  },
  {
    id: 'size_unavailable_alternative',
    label: 'Size unavailable → size-aware alternative',
    cartId: 'CART-014',
    customerTurns: [
      "Hi! Is the kurta still available in size L? That's what I need.",
      "Oh no, okay — is the Sage one available in L then? I'd love that instead.",
    ],
  },
  {
    id: 'budget_aware_alternative',
    label: 'States a budget → budget-aware alternative',
    cartId: 'CART-015',
    customerTurns: [
      "Hi, thanks — honestly ₹2499 is a bit much for trousers right now. Do you have anything similar under ₹2000?",
      "That works, I'll go with the wide-leg ones instead — send me the link please.",
    ],
  },
  {
    id: 'colour_aware_alternative',
    label: "Dislikes colour → colour-aware alternative",
    cartId: 'CART-016',
    customerTurns: [
      "Hi, I actually love the fit but I'm not really feeling this clay colour. Do you have it in anything else?",
      "The undyed natural one sounds perfect, I'll take that.",
    ],
  },
  {
    id: 'multi_item_partial_selection',
    label: 'Multi-item cart → keeps only one item',
    cartId: 'CART-002',
    customerTurns: [
      "Hi! Actually I only really want the co-ord set, not the top.",
      "Yes please, go ahead and send me the checkout link for that.",
    ],
  },
  {
    id: 'opt_out_then_reengage',
    label: 'Opts out, then messages back in and buys',
    cartId: 'CART-012',
    customerTurns: [
      "Please stop messaging me, I'm not interested.",
      "Actually, sorry — I changed my mind. Is the shawl still available? I'd like to get it after all.",
      "Great, send me the checkout link please.",
    ],
  },

  // -----------------------------------------------------------------
  // TRIGGER 1: RECOMMENDATIONS FROM HISTORY
  // -----------------------------------------------------------------
  {
    id: 'recommendation_accept',
    label: 'Recommendation → accepts and buys',
    cartId: 'CART-104',
    customerTurns: ["Oh that's a great idea, they'd go really well together — yes, send it over!"],
  },
  {
    id: 'recommendation_decline',
    label: 'Recommendation → politely declines',
    cartId: 'CART-105',
    customerTurns: ["It's nice but I don't think I need it right now, thank you though!"],
  },

  // -----------------------------------------------------------------
  // TRIGGER 2: BROWSE-AND-ABANDON
  // -----------------------------------------------------------------
  {
    id: 'browse_abandonment_accept',
    label: 'Browse-abandon → asks a question, then buys',
    cartId: 'CART-106',
    customerTurns: [
      "Oh I have been eyeing that one! Does it run true to size?",
      "Great, I'll take it — please send the checkout link.",
    ],
  },
  {
    id: 'browse_abandonment_decline',
    label: "Browse-abandon → \"just looking\"",
    cartId: 'CART-107',
    customerTurns: ["Thanks, I'm honestly just looking around for now, not ready to buy yet."],
  },
];

export function getScenario(id: string): Scenario | undefined {
  return scenarios.find((s) => s.id === id);
}
