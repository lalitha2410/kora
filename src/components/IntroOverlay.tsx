interface IntroOverlayProps {
  accent: string;
  onDismiss: () => void;
}

/**
 * Shown once per session on first load, never again after dismissal —
 * plain useState in App.tsx, deliberately not wired into the reset()
 * flow so clicking Reset mid-demo doesn't bring it back and interrupt a
 * live walkthrough. A page refresh does bring it back, consistent with
 * this app's "everything is in-memory" design (see the note by Reset).
 */
export function IntroOverlay({ accent, onDismiss }: IntroOverlayProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="max-w-sm rounded-lg bg-white p-5 shadow-xl">
        <p className="text-[13px] font-semibold text-[#111827]">👋 Welcome to the cart recovery agent demo</p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#4b5563]">
          The <strong>left panel</strong> is what the customer sees on WhatsApp. The <strong>right panel</strong> is
          the brand's campaign dashboard, updating live as the agent works — nobody sees both at once in real life,
          but seeing them side by side is the whole point of this demo.
        </p>
        <p className="mt-2 text-[12.5px] leading-relaxed text-[#4b5563]">
          Try <strong>Play scenario</strong> in the left panel to see an objection get handled without typing.
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-4 w-full rounded-md px-3 py-2 text-[12.5px] font-medium text-white"
          style={{ backgroundColor: accent }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
