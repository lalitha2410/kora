import type { ProductImage } from '../types';
import { getCatalogItem } from '../data/catalog';

/**
 * The ONLY place a ProductImage is ever built — always from a real
 * data/catalog.ts entry via getCatalogItem, never from anything an LLM
 * reply says. useCartRecoveryAgent.ts calls this exclusively from actual
 * tool results (the itemIds a tool call genuinely returned this turn) or
 * from a seeded cart's own item (the opening-message image) — never by
 * trying to parse a product name back out of generated text. Returns
 * undefined for an unknown itemId rather than throwing, same "degrade
 * quietly, never crash the demo" convention as resolveCart.
 *
 * `productBaseUrl` is a parameter, not a module constant, for the same
 * reason createCheckoutLinkTool takes `checkoutBaseUrl` as an argument
 * instead of hardcoding one — see BrandConfig's own doc: exactly one place
 * (config/brand.ts) knows what a real product link looks like, so
 * re-pointing this demo at a different brand is a one-file change.
 * `productUrl` is a plain, code-computed field on ProductImage — never
 * something the model states in text — so every product actually shown to
 * a customer carries a real, clickable link with no chance of the same
 * "plausible but invented URL" failure mode looksLikeFabricatedCheckoutLink
 * exists to catch on the checkout side.
 */
export function productImageFor(itemId: string, productBaseUrl: string): ProductImage | undefined {
  const item = getCatalogItem(itemId);
  if (!item) return undefined;
  return {
    itemId: item.itemId,
    name: item.name,
    price: item.price,
    imageUrl: item.imageUrl,
    productUrl: `${productBaseUrl}/${item.itemId}`,
  };
}

/** Emoji numerals matching the 1️⃣2️⃣3️⃣ markers systemPrompt.ts asks the
 * model to use for a numbered options list — every alternative/
 * recommendation/sale tool caps results at 3 (see tools.ts's `.slice(0,
 * 3)` convention), so 3 is always enough. Image captions reuse the same
 * numeral so a customer can visually match "2️⃣" in the text list to the
 * right product photo above it. */
export const OPTION_NUMERAL_EMOJI = ['1️⃣', '2️⃣', '3️⃣'] as const;

/**
 * Deliberately just the bare numeral (e.g. "1️⃣"), or nothing at all for a
 * single un-numbered product (browse-abandonment, a single recommendation,
 * the opening message) — NOT the item's name and price. Those already
 * appear twice without this: once on the numbered text list
 * systemPrompt.ts's PRESENTING ALTERNATIVES step requires, and once again
 * here if this repeated them — found live, a customer saw the same "Item
 * Name — ₹2,799" twice in a row, once as an image caption and again a
 * message later as plain text. The photo and the caption number are the
 * visual half of the presentation; the text reply is the verbal half —
 * each carries information the other doesn't, instead of both carrying
 * everything.
 */
export function productImageCaption(number?: number): string {
  return number && OPTION_NUMERAL_EMOJI[number - 1] ? OPTION_NUMERAL_EMOJI[number - 1] : '';
}
