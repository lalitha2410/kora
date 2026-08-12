import type { BrandColors } from '../config/brand';
import type { CampaignType } from '../types';
import type { CampaignStats } from '../hooks/useCartRecoveryAgent';
import { CAMPAIGN_TYPES } from '../hooks/useCartRecoveryAgent';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const TYPE_LABELS: Record<CampaignType, string> = {
  cart_recovery: 'Cart Recovery',
  recommendation: 'Recommendations',
  browse_abandonment: 'Browse Abandonment',
};

/**
 * The "combined view" the campaign-type selector doesn't otherwise give
 * you: confirmed-paid revenue side by side across all three triggers, in
 * one glance, regardless of which single type is currently selected below
 * it — this is why it reads `statsByType` directly rather than whatever
 * scope CampaignTypeSelector is set to. Same bar-with-width-encodes-share
 * language as RecoveryFunnel (one flat accent fill, width is the only
 * signal), so this doesn't invent a third visual vocabulary on top of the
 * hero cards and the funnel.
 */
export function RevenueByCampaignType({
  statsByType,
  colors,
}: {
  statsByType: Record<CampaignType, CampaignStats>;
  colors: BrandColors;
}) {
  const max = Math.max(1, ...CAMPAIGN_TYPES.map((t) => statsByType[t].revenueRecovered));

  return (
    <div className="rounded-lg px-3.5 py-2.5" style={{ backgroundColor: colors.paperRaised, boxShadow: `0 0 0 1px ${colors.ink}0F` }}>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: `${colors.ink}99` }}>
          Revenue by campaign type
        </p>
        <p className="text-[10.5px]" style={{ color: `${colors.ink}66` }}>
          confirmed paid, this session
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {CAMPAIGN_TYPES.map((type) => {
          const s = statsByType[type];
          const widthPct = s.revenueRecovered > 0 ? Math.max(6, Math.round((s.revenueRecovered / max) * 100)) : 0;
          return (
            <div key={type} className="flex items-center gap-2.5">
              <span className="w-28 shrink-0 text-[10.5px] font-medium" style={{ color: `${colors.ink}bb` }}>
                {TYPE_LABELS[type]}
              </span>
              <div className="relative h-4.5 min-w-0 flex-1 rounded-sm" style={{ backgroundColor: `${colors.ink}0D` }}>
                {widthPct > 0 && (
                  <div
                    className="flex h-4.5 items-center justify-end rounded-sm px-1.5 transition-[width] duration-500"
                    style={{ width: `${widthPct}%`, backgroundColor: colors.accent }}
                  />
                )}
              </div>
              <span className="w-20 shrink-0 text-right font-mono text-[10.5px]" style={{ color: colors.ink }}>
                {s.revenueRecovered === 0 ? '—' : rupee.format(s.revenueRecovered)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
