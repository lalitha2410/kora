import { useState, type ReactNode } from 'react';

interface SplitViewProps {
  accent: string;
  left: ReactNode;
  right: ReactNode;
}

/**
 * Fixed 50/50 split above `md` (768px) — the whole point of this demo is
 * showing the customer's WhatsApp thread and the brand's dashboard side by
 * side, so the split is never allowed to shrink into two unreadable
 * slivers. Below `md`, chat goes full width and the dashboard becomes a
 * tab. Both panels stay mounted (hidden, not unmounted) so switching tabs
 * never loses chat scroll position or an in-progress draft.
 */
export function SplitView({ accent, left, right }: SplitViewProps) {
  const [mobileTab, setMobileTab] = useState<'left' | 'right'>('left');

  const tabButtonClass = (tab: 'left' | 'right') =>
    `flex-1 border-b-2 py-2 text-[12.5px] font-medium transition-colors ${
      mobileTab === tab ? 'text-[#111827]' : 'border-transparent text-[#6b7280]'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-2">
      <div className="flex border-b border-[#e2e4e8] bg-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileTab('left')}
          className={tabButtonClass('left')}
          style={mobileTab === 'left' ? { borderColor: accent, color: accent } : undefined}
        >
          💬 WhatsApp
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('right')}
          className={tabButtonClass('right')}
          style={mobileTab === 'right' ? { borderColor: accent, color: accent } : undefined}
        >
          📊 Campaign
        </button>
      </div>

      <div
        className={`min-h-0 flex-1 flex-col border-[#e2e4e8] md:flex-none md:border-r ${
          mobileTab === 'left' ? 'flex' : 'hidden md:flex'
        }`}
      >
        {left}
      </div>
      <div className={`min-h-0 flex-1 flex-col ${mobileTab === 'right' ? 'flex' : 'hidden md:flex'}`}>{right}</div>
    </div>
  );
}
