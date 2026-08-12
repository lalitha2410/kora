import type { BrandColors } from '../config/brand';
import type { CampaignStats } from '../hooks/useCartRecoveryAgent';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * The two numbers a growth lead screenshots. Deliberately NOT another equal
 * tile in a six-up row — a white "raised" card on the tinted page
 * background, the dashboard's one saturated accent hue reserved for the
 * figure itself, and roughly 2x the type size of everything else on this
 * panel. Six equal cards reads as generic; these two get a different shape
 * of card entirely, not just a bigger font.
 *
 * The number itself is `accentDark`, not `accent` — `accent` is tuned for
 * FILLS (light enough that dark text reads on top of it), which makes it
 * too light to pass contrast as 30px text on a white card. `accentDark` is
 * the same brand hue, darkened for exactly this case.
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
    <div className="grid grid-cols-1 gap-2 px-3 pt-2.5 sm:grid-cols-2">
      <div className="rounded-lg px-3.5 py-3" style={{ backgroundColor: colors.paperRaised, boxShadow: `0 0 0 1px ${colors.ink}0F` }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: `${colors.ink}99` }}>
          Revenue recovered
        </p>
        <p className="mt-1 font-mono text-[28px] font-bold leading-none" style={{ color: colors.accentDark }}>
          {rupee.format(stats.revenueRecovered)}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: `${colors.ink}12` }}>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${recoveredSharePct}%`, backgroundColor: colors.accent }}
          />
        </div>
        <p className="mt-1.5 text-[10.5px]" style={{ color: `${colors.ink}88` }}>
          {rupee.format(stats.revenueAtRisk)} still at risk across {activeCount} open cart{activeCount === 1 ? '' : 's'}
        </p>
      </div>

      <div className="rounded-lg px-3.5 py-3" style={{ backgroundColor: colors.paperRaised, boxShadow: `0 0 0 1px ${colors.ink}0F` }}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: `${colors.ink}99` }}>
          Recovery rate
        </p>
        <p className="mt-1 font-mono text-[28px] font-bold leading-none" style={{ color: colors.accentDark }}>
          {stats.recoveryRate}%
        </p>
        <div className="mt-2 flex gap-1">
          {Array.from({ length: stats.cartsTargeted }).map((_, i) => (
            <span
              key={i}
              className="h-1.5 flex-1 rounded-full"
              style={{ backgroundColor: i < stats.recoveredCount ? colors.accent : `${colors.ink}12` }}
            />
          ))}
        </div>
        <p className="mt-1.5 text-[10.5px]" style={{ color: `${colors.ink}88` }}>
          {stats.recoveredCount} of {stats.cartsTargeted} carts recovered
        </p>
      </div>
    </div>
  );
}
