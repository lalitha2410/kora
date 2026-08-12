import type { AbandonedCart, CatalogItem } from '../types';
import { getCatalogItem } from '../data/catalog';

/**
 * Deterministic discount-eligibility rules. The LLM never decides a
 * discount itself — it calls checkDiscountEligibility()/generateDiscountCode()
 * and reports whatever comes back. A brand cannot let a language model
 * improvise pricing; these are plain functions a QA engineer can unit-test
 * without ever touching the model (see the __tests below, run directly with
 * `npx tsx src/lib/pricingPolicy.test.ts` before any LLM wiring existed).
 */

/** Minimum gross margin, as a percentage of price, Kora will ever discount
 * into. A discount can shrink margin but never past this floor, regardless
 * of what the cart-value tier would otherwise allow. */
export const MARGIN_FLOOR_PERCENT = 20;

/** A cart abandoned more recently than this is not offered a discount —
 * reaching for a discount within minutes of someone leaving reads as
 * desperate, not helpful. */
export const MIN_CART_AGE_MS = 15 * 60 * 1000;

/** Max discount allowed purely by cart value, before the margin floor is
 * applied. Higher-value carts can absorb a deeper percentage cut. */
export function tierCapPercent(cartValue: number): number {
  if (cartValue <= 2000) return 10;
  if (cartValue <= 5000) return 12;
  return 15;
}

export interface ResolvedCartItem {
  itemId: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  lineTotal: number;
  onSale: boolean;
  inStock: boolean;
  marginPercent: number;
}

export interface ResolvedCart {
  cartValue: number;
  items: ResolvedCartItem[];
  anyOnSale: boolean;
  anyOutOfStock: boolean;
}

/** Joins a cart's line items against the product catalog. Returns null for
 * any line whose product can't be found rather than throwing — a seed-data
 * bug should degrade to "skip this line," not crash the demo mid-call. */
export function resolveCart(cart: AbandonedCart): ResolvedCart {
  const items: ResolvedCartItem[] = [];
  for (const line of cart.items) {
    const product: CatalogItem | undefined = getCatalogItem(line.itemId);
    if (!product) continue;
    items.push({
      itemId: product.itemId,
      name: product.name,
      category: product.category,
      price: product.price,
      quantity: line.quantity,
      lineTotal: product.price * line.quantity,
      onSale: product.onSale,
      inStock: product.inStock,
      marginPercent: product.marginPercent,
    });
  }
  const cartValue = items.reduce((sum, i) => sum + i.lineTotal, 0);
  return {
    cartValue,
    items,
    anyOnSale: items.some((i) => i.onSale),
    anyOutOfStock: items.some((i) => !i.inStock),
  };
}

/** Cart-value-weighted average margin across line items, floored at the
 * margin floor. Zero (not negative) when the floor already exceeds the
 * item's own margin — a thin-margin item simply contributes no discount
 * room rather than pulling other lines' room negative. */
export function marginCapPercent(resolved: ResolvedCart): number {
  if (resolved.cartValue <= 0) return 0;
  const weightedMargin =
    resolved.items.reduce((sum, i) => sum + i.marginPercent * i.lineTotal, 0) / resolved.cartValue;
  return Math.max(0, Math.floor(weightedMargin - MARGIN_FLOOR_PERCENT));
}

export function computeMaxDiscountPercent(resolved: ResolvedCart): number {
  if (resolved.cartValue <= 0) return 0;
  return Math.max(0, Math.min(tierCapPercent(resolved.cartValue), marginCapPercent(resolved)));
}

export interface DiscountEligibilityResult {
  eligible: boolean;
  maxDiscountPercent: number;
  cartValue: number;
  reasons: string[];
}

/**
 * The single source of truth for "can this cart get a discount right now."
 * Called both by the read-only checkDiscountEligibility tool and by
 * generateDiscountCode (tools.ts) immediately before it mints a code, so
 * there is exactly one place that can say yes.
 */
export function checkDiscountEligibility(
  cart: AbandonedCart,
  now: number = Date.now(),
): DiscountEligibilityResult {
  const resolved = resolveCart(cart);
  const reasons: string[] = [];

  if (resolved.anyOnSale) {
    reasons.push('Cart contains an item already on sale — no further discount is available on it.');
  }

  const ageMs = now - cart.abandonedAt;
  if (ageMs < MIN_CART_AGE_MS) {
    const minutesLeft = Math.ceil((MIN_CART_AGE_MS - ageMs) / 60000);
    reasons.push(
      `Cart was abandoned too recently (discounts unlock ${minutesLeft} more minute(s) from now) — offering one this early looks desperate.`,
    );
  }

  if (cart.discountOffered) {
    reasons.push('A discount code has already been offered on this cart — only one offer per conversation.');
  }

  const maxDiscountPercent = resolved.anyOnSale ? 0 : computeMaxDiscountPercent(resolved);
  if (!resolved.anyOnSale && maxDiscountPercent <= 0 && reasons.length === 0) {
    reasons.push('This item\'s margin does not leave room for a discount.');
  }

  return {
    eligible: reasons.length === 0 && maxDiscountPercent > 0,
    maxDiscountPercent,
    cartValue: resolved.cartValue,
    reasons,
  };
}

/**
 * The single source of truth for "what did this cart actually cost" —
 * always computed fresh from the cart's CURRENT items (resolveCart, which
 * reads cart.items against the live catalog) and whether a discount was
 * genuinely applied at checkout (cart.checkoutDiscountApplied), never from
 * a dollar figure stored at some earlier moment. Used both by
 * createCheckoutLinkTool (to report the final amount right after a swap)
 * and by the dashboard (to sum revenue recovered) — one function, so a cart
 * whose item changes after checkout (it shouldn't; selectAlternativeTool
 * and createCheckoutLinkTool both refuse once a checkout link exists) can
 * never show two different totals in two different places.
 */
export function amountPaidForCart(cart: AbandonedCart): number {
  const resolved = resolveCart(cart);
  const percent = cart.checkoutDiscountApplied ? (cart.discountPercent ?? 0) : 0;
  return Math.round(resolved.cartValue * (1 - percent / 100));
}
