import { useState, type ReactNode } from 'react';

interface SplitViewProps {
  accent: string;
  left: ReactNode;
  right: ReactNode;
}

/**
 * Fixed 35/65 split above `md` (768px), chat/dashboard — matches the
 * returns demo's proportions rather than an even 50/50. The chat panel
 * only ever needs to fit narrow WhatsApp bubbles; a full half of the
 * screen left a large empty gap above the conversation. The dashboard
 * carries a six-column table plus hero cards and a funnel — it's the side
 * that actually needs the room. The split is never allowed to shrink into
 * two unreadable slivers below `md`, where chat goes full width and the
 * dashboard becomes a tab instead. Both panels stay mounted (hidden, not
 * unmounted) so switching tabs never loses chat scroll position or an
 * in-progress draft.
 */
export function SplitView({ accent, left, right }: SplitViewProps) {
  const [mobileTab, setMobileTab] = useState<'left' | 'right'>('left');

  const tabButtonClass = (tab: 'left' | 'right') =>
    `flex-1 border-b-2 py-2 text-[12.5px] font-medium transition-colors ${
      mobileTab === tab ? 'text-[#111827]' : 'border-transparent text-[#6b7280]'
    }`;

  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[35fr_65fr]">
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
