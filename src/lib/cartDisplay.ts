import type { AbandonedCart } from '../types';
import { getCatalogItem } from '../data/catalog';

/** Pure display formatting for a cart's line items — resolves each line
 * against the product catalog for name/price. UI-only helper (no pricing
 * logic here; prices are read straight off the catalog, never computed). */
export interface ResolvedCartLine {
  itemId: string;
  name: string;
  size: string;
  colour: string;
  quantity: number;
  price: number;
}

export function resolveCartLines(cart: AbandonedCart): ResolvedCartLine[] {
  return cart.items.map((line) => {
    const product = getCatalogItem(line.itemId);
    return {
      itemId: line.itemId,
      name: product?.name ?? line.itemId,
      size: line.size,
      colour: line.colour,
      quantity: line.quantity,
      price: product?.price ?? 0,
    };
  });
}

/** First item's name plus how many more — kept separate rather than one
 * pre-joined "Name +1 more" string, so a caller can put the count in its
 * own non-truncating badge. A joined string inside one `truncate` block
 * loses the "+1 more" the instant the item name alone fills the width,
 * which is what made a multi-item cart read as a single, overpriced item. */
export function firstItemAndExtraCount(cart: AbandonedCart): { first: string; extraCount: number } {
  const lines = resolveCartLines(cart);
  return { first: lines[0]?.name ?? '', extraCount: lines.length - 1 };
}
