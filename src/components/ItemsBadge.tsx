import { useEffect, useRef, useState } from 'react';
import type { AbandonedCart } from '../types';
import type { BrandColors } from '../config/brand';
import { resolveCartLines } from '../lib/cartDisplay';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

interface ItemsBadgeProps {
  cart: AbandonedCart;
  colors: BrandColors;
  /** The two places this renders sit on different light surfaces — the
   * WhatsApp header vs. the campaign table — so the pill's resting/hover
   * colors differ slightly, but the disclosure itself (open, outside-click
   * to close, the item breakdown) is identical either place. */
  surface: 'whatsapp' | 'table';
}

/**
 * The "+N" next to a multi-item cart used to just be text — a viewer on a
 * live call will click it expecting something, and a dead control reads
 * worse than no control at all. This makes it a real disclosure: click/tap
 * opens a small popover listing every item in the cart with its own price,
 * so a ₹4,598 two-item cart visibly breaks down into its parts instead of
 * looking like one overpriced item.
 */
export function ItemsBadge({ cart, colors, surface }: ItemsBadgeProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lines = resolveCartLines(cart);
  const extraCount = lines.length - 1;

  useEffect(() => {
    if (!open) return;
    function onOutsideClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutsideClick);
    return () => document.removeEventListener('mousedown', onOutsideClick);
  }, [open]);

  if (extraCount <= 0) return null;

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label={`Show all ${lines.length} items in this cart`}
        className="flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold transition-colors"
        style={
          surface === 'whatsapp'
            ? { backgroundColor: open ? '#dbe0e3' : '#e9edef', color: '#3b4a54' }
            : {
                backgroundColor: open ? `${colors.accent}26` : '#EDEFF2',
                color: open ? colors.accentDark : '#5B6270',
              }
        }
      >
        +{extraCount}
        <svg
          viewBox="0 0 12 12"
          width="8"
          height="8"
          className={`transition-transform duration-150 ${open ? '-rotate-180' : ''}`}
        >
          <path
            d="M2.5 4.5 6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 top-full z-30 mt-1 w-60 rounded-md border border-[#E4E7EC] bg-white py-1.5 shadow-lg"
        >
          <p className="px-2.5 pb-1 text-[9.5px] font-semibold uppercase tracking-[0.06em] text-[#9AA1AC]">
            {lines.length} items in cart
          </p>
          {lines.map((line) => (
            <div key={line.itemId} className="flex items-center justify-between gap-2 px-2.5 py-1 text-[11px]">
              <span className="min-w-0 truncate text-[#1A1D22]">
                {line.name}
                <span className="text-[#9AA1AC]">
                  {' '}
                  · {line.size}
                  {line.quantity > 1 ? ` ×${line.quantity}` : ''}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular-nums text-[#1A1D22]">
                {rupee.format(line.price * line.quantity)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
