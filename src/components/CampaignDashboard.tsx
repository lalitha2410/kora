import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import type { AbandonedCart, CampaignType } from '../types';
import type { CampaignStats } from '../hooks/useCartRecoveryAgent';
import { HeroStats } from './HeroStats';
import { RecoveryFunnel } from './RecoveryFunnel';
import { SecondaryStats } from './SecondaryStats';
import { RevenueByCampaignType } from './RevenueByCampaignType';
import { CampaignTypeSelector, type DashboardScope } from './CampaignTypeSelector';
import { CartTableHeader, CartTableRow } from './CartTable';

interface CampaignDashboardProps {
  brand: BrandConfig;
  carts: AbandonedCart[];
  stats: CampaignStats;
  /** Same KPI shape as `stats`, pre-computed per campaign type — see
   * useCartRecoveryAgent.ts's computeCampaignStats. Reading this instead of
   * re-filtering `carts` and re-deriving the KPIs here keeps exactly one
   * place (the hook) responsible for what each figure actually means. */
  statsByType: Record<CampaignType, CampaignStats>;
  toolActivity: string | null;
  activeCartId: string;
  onSelectCart: (cartId: string) => void;
  /** The demo-only "Mark as paid" control — see useCartRecoveryAgent.ts's
   * markPaid and tools.ts's markCartPaidTool file-level comment for why
   * this is a direct cart mutation, never something the LLM can trigger. */
  onMarkPaid: (cartId: string) => void;
}

const TIME_LABEL: Record<DashboardScope, string> = {
  all: 'Last activity',
  cart_recovery: 'Abandoned',
  recommendation: 'Sent',
  browse_abandonment: 'Sent',
};

/**
 * Deliberately a different structural rhythm from the returns console's
 * header + stat-row + table stack: a live-campaign pulse in the header,
 * two oversized hero cards for the numbers a growth lead actually
 * screenshots, a funnel visual the ops console never needed, a demoted
 * numeric strip for the rest, then the table. Same underlying state as
 * before (CampaignStats, carts) — this file only reshapes how it's shown.
 *
 * LIGHT throughout, on purpose — this went through a dark near-black-panel
 * iteration first. Found live: next to the bright WhatsApp panel, a dark
 * dashboard created a hard visual break, so the screen read as two
 * separate apps rather than one demo side by side. Vastra's returns
 * console works precisely because both its panels are light; Kora now
 * follows the same structural principle and stays distinct through the
 * dusty-rose accent instead of through a dark shell. `colors.paper` (a
 * barely-there grey-rose, never cream) is the page background every
 * section sits on; `colors.paperRaised` (white) is what each card/table
 * actually renders on, for a subtle lift off the page.
 */
export function CampaignDashboard({
  brand,
  carts,
  stats,
  statsByType,
  toolActivity,
  activeCartId,
  onSelectCart,
  onMarkPaid,
}: CampaignDashboardProps) {
  const colors = brand.colors;

  // 'all' reproduces this dashboard's original behavior exactly (every
  // cart, the hook's overall `stats`) — every individual campaign type
  // instead scopes both the cart list AND the KPIs to just that type, via
  // statsByType (see useCartRecoveryAgent.ts's computeCampaignStats), so
  // the funnel/hero/secondary numbers are never "all carts' stats next to
  // one type's table" — they always agree with what's actually listed
  // below them.
  const [scope, setScope] = useState<DashboardScope>('all');
  const displayedCarts = useMemo(
    () => (scope === 'all' ? carts : carts.filter((c) => c.campaignType === scope)),
    [carts, scope],
  );
  const displayedStats = scope === 'all' ? stats : statsByType[scope];

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
  // rather than added to CampaignStats for a single caller. Scoped to
  // displayedCarts so it agrees with whichever campaign type is selected.
  const activeCount = useMemo(() => displayedCarts.filter((c) => c.outcome === 'active').length, [displayedCarts]);

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ backgroundColor: colors.paper }}>
      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{ backgroundColor: colors.paperRaised, borderBottom: `1px solid ${colors.ink}0F` }}
      >
        <div>
          <p
            className="text-[13px] font-semibold leading-tight tracking-[0.01em]"
            style={{ color: colors.ink }}
          >
            Cart Recovery Campaign
          </p>
          <p className="text-[10.5px] leading-tight" style={{ color: `${colors.ink}88` }}>
            {brand.name} · {brand.vertical}
          </p>
        </div>
        <div
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ backgroundColor: `${colors.accent}1F`, color: colors.accentDark }}
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: colors.accent }} />
          Live campaign
        </div>
      </div>

      <div
        data-testid="tool-activity"
        data-active={toolActivity ? 'true' : 'false'}
        className={`flex items-center gap-2 px-3.5 text-[11px] font-medium transition-[height,opacity,padding] duration-200 ${
          toolActivity ? 'h-6 py-1 opacity-100' : 'h-0 overflow-hidden py-0 opacity-0'
        }`}
        style={{ color: colors.accentDark, backgroundColor: colors.paperRaised }}
      >
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ backgroundColor: colors.accent }} />
        <span>{toolActivity}</span>
      </div>

      <CampaignTypeSelector colors={colors} value={scope} onChange={setScope} />

      <HeroStats stats={displayedStats} colors={colors} activeCount={activeCount} />

      <div className="px-3 pt-2">
        <RecoveryFunnel
          colors={colors}
          stages={[
            { label: 'Targeted', value: displayedStats.cartsTargeted },
            { label: 'Messaged', value: displayedStats.messagesSent },
            { label: 'Replied', value: displayedStats.repliesReceived },
            { label: 'Link sent', value: displayedStats.linkSentCount },
            { label: 'Paid', value: displayedStats.recoveredCount },
          ]}
        />
      </div>

      <div className="pt-2">
        <SecondaryStats stats={displayedStats} colors={colors} />
      </div>

      {/* Always all four types, regardless of `scope` — see
          RevenueByCampaignType's own doc for why this reads statsByType
          directly instead of displayedStats. */}
      <div className="px-3 pt-2">
        <RevenueByCampaignType statsByType={statsByType} colors={colors} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2.5">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: `${colors.ink}77` }}>
          Cart outcomes ({displayedCarts.length})
        </p>
        <div
          className="min-w-165 overflow-hidden rounded-md"
          style={{ boxShadow: `0 0 0 1px ${colors.ink}14`, backgroundColor: colors.paperRaised }}
        >
          <CartTableHeader colors={colors} timeLabel={TIME_LABEL[scope]} />
          {displayedCarts.map((c, i) => (
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
        <p className="mt-2 text-[10.5px]" style={{ color: `${colors.ink}55` }}>
          Click any row to open that customer's WhatsApp thread on the left.
        </p>
      </div>
    </div>
  );
}
