import type { BrandColors } from '../config/brand';
import type { CampaignType } from '../types';
import { CAMPAIGN_TYPES } from '../hooks/useCartRecoveryAgent';

export type DashboardScope = 'all' | CampaignType;

const LABELS: Record<DashboardScope, string> = {
  all: 'All campaigns',
  cart_recovery: 'Cart Recovery',
  recommendation: 'Recommendations',
  browse_abandonment: 'Browse Abandonment',
};

/**
 * "All campaigns" plus the three individual campaign types (see
 * CAMPAIGN_TYPES) — the funnel/hero/secondary stats and the outcomes table
 * below this all re-derive from whichever scope is selected here (see
 * CampaignDashboard's own displayedCarts/displayedStats). Deliberately a
 * row of plain toggle pills, not a native <select> — four short labels fit
 * comfortably and a row keeps every option visible at once, which matters
 * for a demo meant to show off every trigger side by side.
 */
export function CampaignTypeSelector({
  colors,
  value,
  onChange,
}: {
  colors: BrandColors;
  value: DashboardScope;
  onChange: (scope: DashboardScope) => void;
}) {
  const scopes: DashboardScope[] = ['all', ...CAMPAIGN_TYPES];
  return (
    <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
      {scopes.map((scope) => {
        const active = scope === value;
        return (
          <button
            key={scope}
            type="button"
            onClick={() => onChange(scope)}
            className="rounded-full px-2.5 py-1 text-[10.5px] font-semibold transition-colors"
            style={
              active
                ? { backgroundColor: colors.accentDark, color: '#FFFFFF' }
                : { backgroundColor: colors.paperRaised, color: `${colors.ink}99`, boxShadow: `0 0 0 1px ${colors.ink}14` }
            }
          >
            {LABELS[scope]}
          </button>
        );
      })}
    </div>
  );
}
