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
 */
export function productImageFor(itemId: string): ProductImage | undefined {
  const item = getCatalogItem(itemId);
  if (!item) return undefined;
  return { itemId: item.itemId, name: item.name, price: item.price, imageUrl: item.imageUrl };
}

/** Emoji numerals matching the 1️⃣2️⃣3️⃣ markers systemPrompt.ts asks the
 * model to use for a numbered options list — every alternative/
 * recommendation/sale tool caps results at 3 (see tools.ts's `.slice(0,
 * 3)` convention), so 3 is always enough. Image captions reuse the same
 * numeral so a customer can visually match "2️⃣" in the text list to the
 * right product photo above it. */
export const OPTION_NUMERAL_EMOJI = ['1️⃣', '2️⃣', '3️⃣'] as const;

/** "1️⃣ Item Name — ₹2,799", or just "Item Name — ₹2,799" when there's only
 * ever one product on the table (browse-abandonment, a single
 * recommendation, the opening message) — no number to attach to. */
export function productImageCaption(image: ProductImage, number?: number): string {
  const prefix = number && OPTION_NUMERAL_EMOJI[number - 1] ? `${OPTION_NUMERAL_EMOJI[number - 1]} ` : '';
  return `${prefix}${image.name} — ₹${image.price.toLocaleString('en-IN')}`;
}
