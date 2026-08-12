import type { BrandColors } from '../config/brand';
import type { CampaignStats } from '../hooks/useCartRecoveryAgent';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * The two numbers a growth lead screenshots. Deliberately NOT another equal
 * tile in a six-up row — a dark "ink" card, the dashboard's one saturated
 * accent reserved for the figure itself, and roughly 2x the type size of
 * everything else on this panel. Six equal cards reads as generic; these
 * two get a different shape of card entirely, not just a bigger font.
 */
export function HeroStats({
  stats,
  colors,
  activeCount,
}: {
  stats: CampaignStats;
  colors: BrandColors;
  activeCount: number;
}) {
  const recoveredSharePct =
    stats.totalCartValue <= 0 ? 0 : Math.min(100, (stats.revenueRecovered / stats.totalCartValue) * 100);

  return (
    <div className="grid grid-cols-1 gap-2.5 px-3 pt-3 sm:grid-cols-2">
      <div className="rounded-lg px-4 py-3.5" style={{ backgroundColor: colors.inkRaised }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: `${colors.paper}99` }}>
          Revenue recovered
        </p>
        <p className="mt-1 font-mono text-[30px] font-bold leading-none" style={{ color: colors.accent }}>
          {rupee.format(stats.revenueRecovered)}
        </p>
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: `${colors.paper}22` }}>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${recoveredSharePct}%`, backgroundColor: colors.accent }}
          />
        </div>
        <p className="mt-1.5 text-[10.5px]" style={{ color: `${colors.paper}88` }}>
          {rupee.format(stats.revenueAtRisk)} still at risk across {activeCount} open cart{activeCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="rounded-lg px-4 py-3.5" style={{ backgroundColor: colors.inkRaised }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: `${colors.paper}99` }}>
          Recovery rate
        </p>
        <p className="mt-1 font-mono text-[30px] font-bold leading-none" style={{ color: colors.accent }}>
          {stats.recoveryRate}%
        </p>
        <div className="mt-2.5 flex gap-1">
          {Array.from({ length: stats.cartsTargeted }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{ backgroundColor: i < stats.recoveredCount ? colors.accent : `${colors.paper}22` }}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px]" style={{ color: `${colors.paper}88` }}>
          {stats.recoveredCount} of {stats.cartsTargeted} carts recovered
        </p>
      </div>
    </div>
  );
}
