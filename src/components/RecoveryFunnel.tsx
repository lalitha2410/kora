import type { BrandColors } from '../config/brand';

export interface FunnelStage {
  label: string;
  value: number;
}

/**
 * The one visual the returns console never needed — a growth lead thinks in
 * funnels, an ops team doesn't. Five ordered stages, ONE flat accent color
 * for every bar — width alone encodes the narrowing, so there's no need for
 * (and no case for) a multi-step color ramp. An earlier version stepped a
 * 4-shade brown ramp light→dark here; that's exactly the "warm, muddy,
 * still reads as the returns console" look this was redone to get away
 * from. Bar label text is dark (`colors.ink`), not white — `colors.accent`
 * is a light-medium rose, and white-on-light-rose is the pairing that
 * reads poorly; dark text on a bright fill is the legible direction here.
 *
 * Card surface matches HeroStats' `paperRaised` deliberately — this and
 * the two hero cards are the same "white card on the tinted page" surface,
 * not three different one-off treatments. Light on purpose (see
 * BrandColors' own doc): a dark funnel card next to a light table and
 * light WhatsApp panel would be the same "one dark block among light ones"
 * problem this whole panel moved away from.
 */
function pct(value: number, of: number): string {
  if (of <= 0) return '—';
  return `${Math.round((value / of) * 100)}%`;
}

export function RecoveryFunnel({ stages, colors }: { stages: FunnelStage[]; colors: BrandColors }) {
  const max = Math.max(1, ...stages.map((s) => s.value));

  return (
    <div className="rounded-lg px-3.5 py-2.5" style={{ backgroundColor: colors.paperRaised, boxShadow: `0 0 0 1px ${colors.ink}0F` }}>
      <div className="mb-2 flex items-baseline justify-between">
        <p
          className="text-[11px] font-semibold uppercase tracking-[0.08em]"
          style={{ color: `${colors.ink}99` }}
        >
          Recovery funnel
        </p>
        <p className="text-[10.5px]" style={{ color: `${colors.ink}66` }}>
          carts, this session
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {stages.map((stage, i) => {
          const widthPct = Math.max(6, Math.round((stage.value / max) * 100));
          const prev = i > 0 ? stages[i - 1].value : null;
          return (
            <div key={stage.label} className="flex items-center gap-2.5">
              <span className="w-16 shrink-0 text-[10.5px] font-medium" style={{ color: `${colors.ink}bb` }}>
                {stage.label}
              </span>
              <div
                className="relative h-4.5 min-w-0 flex-1 rounded-sm"
                style={{ backgroundColor: `${colors.ink}0D` }}
              >
                <div
                  className="flex h-4.5 items-center justify-end rounded-sm px-1.5 transition-[width] duration-500"
                  style={{ width: `${widthPct}%`, backgroundColor: colors.accent }}
                >
                  <span className="text-[10.5px] font-semibold" style={{ color: colors.ink }}>
                    {stage.value}
                  </span>
                </div>
              </div>
              <span className="w-9 shrink-0 text-right font-mono text-[10px]" style={{ color: `${colors.ink}66` }}>
                {prev !== null ? pct(stage.value, prev) : ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
