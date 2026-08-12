import type { BrandColors } from '../config/brand';
import type { CampaignStats } from '../hooks/useCartRecoveryAgent';

const rupee = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

/**
 * The remaining numbers, deliberately demoted relative to HeroStats — no
 * clay coloring on the figures (that's reserved for the two hero numbers),
 * just plain paper-toned text on the same `inkRaised` card surface as the
 * funnel and hero cards. A dense inline strip, not an equal-weight tile
 * grid — the "denser data, more numeric emphasis" register a
 * growth/analytics tool reads in, as opposed to the returns console's row
 * of identical white bordered tiles.
 *
 * Hairlines between cells are a `gap-px` trick (parent painted the divider
 * tint, each cell painted the card color over it) rather than Tailwind's
 * `divide-x`, which needs a `divide-{color}` utility class — an inline
 * style on the parent can't hand a border-color down to children since
 * border-color isn't an inherited CSS property.
 */
function Metric({ label, value, colors, title }: { label: string; value: string; colors: BrandColors; title?: string }) {
  return (
    <div className="min-w-0 px-3 py-2" style={{ backgroundColor: colors.inkRaised }} title={title}>
      <p
        className="truncate text-[9.5px] font-medium uppercase tracking-[0.06em]"
        style={{ color: `${colors.paper}77` }}
        title={label}
      >
        {label}
      </p>
      <p
        className="mt-0.5 truncate font-mono text-[14px] font-semibold leading-tight"
        style={{ color: colors.paper }}
      >
        {value}
      </p>
    </div>
  );
}

export function SecondaryStats({ stats, colors }: { stats: CampaignStats; colors: BrandColors }) {
  return (
    <div
      className="mx-3 grid grid-cols-2 gap-px overflow-hidden rounded-md sm:grid-cols-3 lg:grid-cols-6"
      style={{ backgroundColor: `${colors.paper}1F` }}
    >
      <Metric label="Carts targeted" value={String(stats.cartsTargeted)} colors={colors} />
      <Metric label="Messages sent" value={String(stats.messagesSent)} colors={colors} />
      <Metric label="Replies received" value={String(stats.repliesReceived)} colors={colors} />
      {/* A link existing is intent, not revenue — see CartOutcome's own
          doc. Deliberately separate from "Revenue recovered" (HeroStats),
          which only ever counts confirmed payments. */}
      <Metric
        label="Pending checkout"
        value={stats.pendingCheckoutValue === 0 ? '—' : rupee.format(stats.pendingCheckoutValue)}
        colors={colors}
        title="Checkout links sent but not yet confirmed paid — use 'Mark as paid' on a cart row once payment is confirmed"
      />
      <Metric
        label="Avg. discount given"
        value={stats.avgDiscountPercent === null ? '—' : `${stats.avgDiscountPercent}%`}
        colors={colors}
      />
      {/* Deliberately NOT folded into "Revenue recovered" (HeroStats) or
          "Paid" (the funnel) — this is revenue from carts that opted
          out and then messaged back in on their own; no outbound prompted
          it, so it can't honestly be credited to the campaign. See
          CampaignStats.customerInitiatedRecoveredRevenue and tools.ts's
          createCheckoutLinkTool. */}
      <Metric
        label="Customer-initiated"
        value={stats.customerInitiatedRecoveredCount === 0 ? '—' : rupee.format(stats.customerInitiatedRecoveredRevenue)}
        colors={colors}
        title={
          stats.customerInitiatedRecoveredCount === 0
            ? 'Revenue from opted-out carts that messaged back in on their own and paid — none yet'
            : `${rupee.format(stats.customerInitiatedRecoveredRevenue)} from ${stats.customerInitiatedRecoveredCount} opted-out cart(s) that messaged back in on their own and paid — not campaign-attributed`
        }
      />
    </div>
  );
}
