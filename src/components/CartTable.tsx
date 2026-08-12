import type { AbandonedCart } from '../types';
import type { BrandColors } from '../config/brand';
import { amountPaidForCart, resolveCart } from '../lib/pricingPolicy';
import { firstItemAndExtraCount } from '../lib/cartDisplay';
import { ItemsBadge } from './ItemsBadge';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * Status is conveyed by LIGHTNESS on a cool grey scale, not by a rainbow of
 * hues — the dashboard's single saturated accent (colors.accent) is spent
 * exclusively on "recovered", the one outcome worth celebrating. Everything
 * else (in progress / lost / opted out) is plain neutral grey at a
 * different weight. A left bar on every row, not just a pill, so a whole
 * column of outcomes reads as a scan even without reading the label.
 *
 * An opted-out cart that was nonetheless purchased (customerInitiatedRecovery
 * — the customer messaged back in on their own) gets its own label, but
 * DELIBERATELY stays on the same neutral grey as a plain "Opted out" row,
 * never the accent green "Recovered" gets — the color itself is the signal
 * that this isn't a campaign win, even before anyone reads the label.
 *
 * 'checkout_sent' — a link exists, nobody has confirmed paying yet (see
 * CartOutcome's own doc) — gets a THIRD grey step of its own, distinct
 * from both "In progress" (lighter) and "Recovered" (the one accent-green
 * row): darker than in-progress to read as "further along," but still
 * strictly monochrome, never the accent. The accent stays reserved for a
 * CONFIRMED payment, which is the entire point of this state existing.
 */
function outcomeStyle(
  cart: AbandonedCart,
  colors: BrandColors,
): { label: string; bg: string; fg: string; bar: string; title?: string } {
  switch (cart.outcome) {
    case 'recovered':
      return { label: 'Recovered', bg: `${colors.accent}22`, fg: colors.accentDark, bar: colors.accent };
    case 'checkout_sent':
      return {
        label: 'Checkout sent',
        bg: '#DDE1E6',
        fg: '#3F4550',
        bar: '#9AA3AF',
        title: `Checkout link sent for ${rupee.format(amountPaidForCart(cart))} — not yet confirmed paid`,
      };
    case 'lost':
      return { label: 'Lost', bg: '#EEF0F3', fg: '#3F4550', bar: '#8A93A0' };
    case 'opted_out':
      if (!cart.customerInitiatedRecovery) {
        return { label: 'Opted out', bg: '#E7E9EC', fg: '#6B7280', bar: '#4B525C' };
      }
      return cart.customerInitiatedRecovery.paid
        ? {
            label: 'Opted out · bought',
            bg: '#E7E9EC',
            fg: '#6B7280',
            bar: '#4B525C',
            title: `Purchased ${rupee.format(amountPaidForCart(cart))} after opting out — the customer messaged back in on their own; not campaign-attributed (see "Customer-initiated" in the stats above)`,
          }
        : {
            label: 'Opted out · checkout sent',
            bg: '#E7E9EC',
            fg: '#6B7280',
            bar: '#4B525C',
            title: `Checkout link sent for ${rupee.format(amountPaidForCart(cart))} after opting out — not yet confirmed paid`,
          };
    case 'active':
    default:
      return { label: 'In progress', bg: '#F1F2F4', fg: '#6B7280', bar: '#D8DCE2' };
  }
}

/** True once a cart has a checkout link out but no confirmed payment —
 * the one condition the demo-only "Mark as paid" control appears for. See
 * tools.ts's markCartPaidTool, which accepts exactly these two cases. */
function isAwaitingPayment(cart: AbandonedCart): boolean {
  return cart.outcome === 'checkout_sent' || Boolean(cart.customerInitiatedRecovery && !cart.customerInitiatedRecovery.paid);
}

function timeAgo(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function CartTableHeader({ colors, timeLabel = 'Abandoned' }: { colors: BrandColors; timeLabel?: string }) {
  return (
    <div
      className="grid grid-cols-[3px_1.3fr_1.6fr_0.8fr_0.9fr_0.9fr_0.9fr] gap-2 px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
      style={{ backgroundColor: colors.paper, color: colors.accentDark }}
    >
      <span />
      <span>Customer</span>
      <span>Item(s)</span>
      <span className="text-right">Value</span>
      <span>Status</span>
      <span>Discount</span>
      <span className="text-right">{timeLabel}</span>
    </div>
  );
}

export function CartTableRow({
  cart,
  index,
  colors,
  active,
  flash,
  onSelect,
  onMarkPaid,
}: {
  cart: AbandonedCart;
  index: number;
  colors: BrandColors;
  active: boolean;
  flash: boolean;
  onSelect: () => void;
  /** Demo-only — see isAwaitingPayment/markCartPaidTool. Only ever
   * rendered as a visible control when the cart is actually awaiting
   * payment; harmless to always pass down otherwise. */
  onMarkPaid: () => void;
}) {
  const resolved = resolveCart(cart);
  const zebra = index % 2 === 1;
  const items = firstItemAndExtraCount(cart);
  const style = outcomeStyle(cart, colors);
  const awaitingPayment = isAwaitingPayment(cart);

  return (
    // A <div role="button"> rather than a real <button> — the items cell
    // below renders ItemsBadge, which is itself a real <button> (so its
    // click can call stopPropagation and open a popover without also
    // "selecting" the row). Buttons can't nest inside buttons, so the row
    // trades the free semantics of <button> for explicit keyboard handling.
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      data-testid="cart-row"
      className={`grid w-full cursor-pointer grid-cols-[3px_1.3fr_1.6fr_0.8fr_0.9fr_0.9fr_0.9fr] gap-2 border-b border-[#E4E7EC] py-2 pr-3 text-left text-[11.5px] outline-none transition-colors hover:bg-[#F2F4F6] focus-visible:ring-2 focus-visible:ring-inset ${flash ? 'row-flash' : ''}`}
      style={{
        backgroundColor: active ? `${colors.accent}14` : zebra ? '#F7F8FA' : '#FFFFFF',
        ...({ '--tw-ring-color': colors.accent } as React.CSSProperties),
      }}
    >
      <span className="self-stretch" style={{ backgroundColor: style.bar }} />
      <span className="min-w-0 truncate font-medium text-[#1A1D22]">{cart.customerName}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-[#5B6270]">
        <span className="min-w-0 truncate">{items.first}</span>
        <ItemsBadge cart={cart} colors={colors} surface="table" />
      </span>
      <span className="text-right font-mono tabular-nums text-[#1A1D22]">{rupee.format(resolved.cartValue)}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ backgroundColor: style.bg, color: style.fg }}
          title={style.title}
        >
          {style.label}
        </span>
        {/* Demo-only — stands in for a payment webhook (see README). A
            real <button>, same nested-inside-a-clickable-row pattern
            ItemsBadge already uses: stopPropagation so clicking this
            doesn't also select the row. */}
        {awaitingPayment && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkPaid();
            }}
            className="shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.04em] transition-colors hover:opacity-80"
            style={{ backgroundColor: `${colors.accent}22`, color: colors.accentDark }}
            title="Demo-only: confirm payment for this cart. In production this would happen automatically via a payment webhook, not a manual click — see the README."
          >
            Mark paid
          </button>
        )}
      </span>
      <span className="truncate font-mono tabular-nums text-[#5B6270]">
        {cart.discountOffered ? `${cart.discountPercent}% · ${cart.discountCode}` : '—'}
      </span>
      <span className="text-right text-[#9AA1AC]">{timeAgo(cart.abandonedAt)}</span>
    </div>
  );
}
