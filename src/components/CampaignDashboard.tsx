import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import type { AbandonedCart } from '../types';
import type { CampaignStats } from '../hooks/useCartRecoveryAgent';
import { HeroStats } from './HeroStats';
import { RecoveryFunnel } from './RecoveryFunnel';
import { SecondaryStats } from './SecondaryStats';
import { CartTableHeader, CartTableRow } from './CartTable';

interface CampaignDashboardProps {
  brand: BrandConfig;
  carts: AbandonedCart[];
  stats: CampaignStats;
  toolActivity: string | null;
  activeCartId: string;
  onSelectCart: (cartId: string) => void;
  /** The demo-only "Mark as paid" control — see useCartRecoveryAgent.ts's
   * markPaid and tools.ts's markCartPaidTool file-level comment for why
   * this is a direct cart mutation, never something the LLM can trigger. */
  onMarkPaid: (cartId: string) => void;
}

/**
 * Deliberately a different structural rhythm from the returns console's
 * header + stat-row + table stack: an ink-band header with a live-campaign
 * pulse, two oversized hero cards for the numbers a growth lead actually
 * screenshots, a funnel visual the ops console never needed, a demoted
 * numeric strip for the rest, then the table. Same underlying state as
 * before (CampaignStats, carts) — this file only reshapes how it's shown.
 */
export function CampaignDashboard({
  brand,
  carts,
  stats,
  toolActivity,
  activeCartId,
  onSelectCart,
  onMarkPaid,
}: CampaignDashboardProps) {
  const colors = brand.colors;

  // Flash a row briefly whenever that cart's outcome changes — visible
  // proof the dashboard updates as tool calls land, not just on a full
  // reload. Tracked by comparing outcomes across renders, not by hooking
  // into the tool-call callback directly, since multiple carts' rows can
  // change independently of whichever cart is currently active.
  const prevOutcomesRef = useRef<Record<string, string>>({});
  const [flashing, setFlashing] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevOutcomesRef.current;
    const changed: string[] = [];
    for (const c of carts) {
      if (prev[c.cartId] && prev[c.cartId] !== c.outcome) changed.push(c.cartId);
      prev[c.cartId] = c.outcome;
    }
    if (changed.length === 0) return;
    setFlashing((old) => new Set([...old, ...changed]));
    const handle = setTimeout(() => {
      setFlashing((old) => {
        const next = new Set(old);
        for (const id of changed) next.delete(id);
        return next;
      });
    }, 1200);
    return () => clearTimeout(handle);
  }, [carts]);

  // totalCartValue/revenueAtRisk both live on `stats` now — see
  // useCartRecoveryAgent.ts's CampaignStats, the one place every KPI on
  // this dashboard is derived from `carts`. activeCount is display-only
  // (the "N open carts" caption), kept as its own tiny derivation here
  // rather than added to CampaignStats for a single caller.
  const activeCount = useMemo(() => carts.filter((c) => c.outcome === 'active').length, [carts]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: colors.ink }}>
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: `1px solid ${colors.paper}14` }}
      >
        <div>
          <p
            className="text-[13px] font-semibold leading-tight tracking-[0.01em]"
            style={{ color: colors.paper }}
          >
            Cart Recovery Campaign
          </p>
          <p className="text-[10.5px] leading-tight" style={{ color: `${colors.paper}88` }}>
            {brand.name} · {brand.vertical}
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ backgroundColor: `${colors.paper}14`, color: colors.accent }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: colors.accent }} />
          Live campaign
        </div>
      </div>

      <div
        data-testid="tool-activity"
        data-active={toolActivity ? 'true' : 'false'}
        className={`flex items-center gap-2 px-4 text-[11px] font-medium transition-[height,opacity,padding] duration-200 ${
          toolActivity ? 'h-6 py-1 opacity-100' : 'h-0 overflow-hidden py-0 opacity-0'
        }`}
        style={{ color: colors.accent }}
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ backgroundColor: colors.accent }} />
        <span>{toolActivity}</span>
      </div>

      <HeroStats stats={stats} colors={colors} activeCount={activeCount} />

      <div className="px-3 pt-2.5">
        <RecoveryFunnel
          colors={colors}
          stages={[
            { label: 'Targeted', value: stats.cartsTargeted },
            { label: 'Messaged', value: stats.messagesSent },
            { label: 'Replied', value: stats.repliesReceived },
            { label: 'Link sent', value: stats.linkSentCount },
            { label: 'Paid', value: stats.recoveredCount },
          ]}
        />
      </div>

      <div className="pt-2.5">
        <SecondaryStats stats={stats} colors={colors} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: `${colors.paper}77` }}>
          Cart outcomes ({carts.length})
        </p>
        <div
          className="min-w-165 overflow-hidden rounded-md"
          style={{ boxShadow: `0 0 0 1px ${colors.paper}26`, backgroundColor: colors.paper }}
        >
          <CartTableHeader colors={colors} />
          {carts.map((c, i) => (
            <CartTableRow
              key={c.cartId}
              cart={c}
              index={i}
              colors={colors}
              active={c.cartId === activeCartId}
              flash={flashing.has(c.cartId)}
              onSelect={() => onSelectCart(c.cartId)}
              onMarkPaid={() => onMarkPaid(c.cartId)}
            />
          ))}
        </div>
        <p className="mt-2 text-[10.5px]" style={{ color: `${colors.paper}55` }}>
          Click any row to open that customer's WhatsApp thread on the left.
        </p>
      </div>
    </div>
  );
}
