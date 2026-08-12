import { useState } from 'react';
import type { ChatMessage, ProductImage } from '../types';
import { parseWhatsAppText } from '../lib/formatText';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Renders WhatsApp's *single-asterisk* convention as actual bold, instead
 * of leaving literal asterisks on screen — see lib/formatText.ts. */
function FormattedText({ text }: { text: string }) {
  return (
    <>
      {parseWhatsAppText(text).map((seg, i) =>
        seg.bold ? (
          <strong key={i} className="font-semibold">
            {seg.text}
          </strong>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

/**
 * WhatsApp alignment convention, from the CUSTOMER's own phone screen —
 * this is outbound, so it's the agent who "sent" first, but the alignment
 * rule is unchanged: messages the customer sent are on the right in green
 * with read ticks, messages they received (the agent's) are on the left in
 * white, no ticks.
 */
function ReadTicks() {
  return (
    <svg viewBox="0 0 16 11" width="14" height="10" className="fill-[#53bdeb] shrink-0">
      <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.405-2.272a.463.463 0 0 0-.325-.126.472.472 0 0 0-.338.145l-.334.35a.5.5 0 0 0 .011.707l2.905 2.75a.6.6 0 0 0 .398.16.62.62 0 0 0 .49-.237l6.652-8.22a.499.499 0 0 0-.06-.646z" />
      <path d="M15.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-.788-.744-.749.928.98.927a.6.6 0 0 0 .398.16.62.62 0 0 0 .49-.237l6.652-8.22a.499.499 0 0 0-.06-.646z" />
    </svg>
  );
}

/**
 * Product photos are local files (see public/products/README.md) that may
 * genuinely not exist yet — this is prep work ahead of real photography.
 * On a load failure, this hides itself entirely (`display: none` via early
 * return, not a broken-image icon or any fallback image) — the build spec
 * is explicit that a missing file must omit the image, never substitute a
 * random/wrong one. The caption text below it (in ChatBubble) still
 * renders normally either way, so the message degrades to plain text, not
 * a broken layout.
 */
function ChatProductImage({ image }: { image: ProductImage }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={image.imageUrl}
      alt={image.name}
      data-testid="chat-product-image"
      // Fixed height, not h-auto off the image's natural size — a real
      // WhatsApp media message is compact regardless of the source
      // photo's own aspect ratio. object-cover crops rather than
      // distorting; width still matches the bubble exactly.
      className="block h-60 w-full object-cover"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * A real WhatsApp media message renders as ONE bubble: the image bleeds
 * edge-to-edge to the bubble's own rounded corners (no padding around it),
 * caption text sits below it WITH the normal bubble padding, same
 * timestamp/tick row as any other bubble. The tail triangle has to stay a
 * SIBLING of the image-clipping wrapper, not a child of it — it's
 * positioned via a negative offset (-left-1.5/-right-1.5), and an
 * `overflow-hidden` wrapper (needed to clip the image's corners) would
 * clip that negative-offset tail right off the bubble too if the tail were
 * inside it.
 */
export function ChatBubble({ message }: { message: ChatMessage }) {
  const isCustomer = message.role === 'user';

  return (
    <div
      data-role={message.role}
      className={`wa-bubble-in flex ${isCustomer ? 'justify-end' : 'justify-start'} px-2.5`}
    >
      <div className={`relative max-w-[65%] rounded-lg shadow-sm ${isCustomer ? 'rounded-tr-none' : 'rounded-tl-none'}`}>
        <span
          aria-hidden
          className={[
            'absolute top-0 h-2.5 w-2.5',
            isCustomer
              ? '-right-1.5 bg-[#d9fdd3] [clip-path:polygon(0_0,0%_100%,100%_0)]'
              : '-left-1.5 bg-white [clip-path:polygon(100%_0,0_0,100%_100%)]',
          ].join(' ')}
        />
        <div
          className={[
            'overflow-hidden rounded-lg text-[14px] leading-[1.3] text-[#111b21]',
            isCustomer ? 'rounded-tr-none bg-[#d9fdd3]' : 'rounded-tl-none bg-white',
          ].join(' ')}
        >
          {message.image && <ChatProductImage image={message.image} />}
          <div className="px-2 py-1.25">
            <p className="whitespace-pre-wrap wrap-break-word">
              <FormattedText text={message.text} />
            </p>
            <span className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-[#667781] select-none">
              {formatTime(message.timestamp)}
              {isCustomer && <ReadTicks />}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Agent bubble for text still streaming in — left/white like a finished
 * agent bubble, no timestamp/tick yet since the message isn't "sent" until
 * it's done generating. */
export function StreamingBubble({ text }: { text: string }) {
  return (
    <div data-role="agent" data-streaming="true" className="wa-bubble-in flex justify-start px-2.5">
      <div className="relative max-w-[65%] rounded-lg rounded-tl-none bg-white px-2 py-1.25 text-[14px] leading-[1.3] text-[#111b21] shadow-sm">
        <span
          aria-hidden
          className="absolute -left-1.5 top-0 h-2.5 w-2.5 bg-white [clip-path:polygon(100%_0,0_0,100%_100%)]"
        />
        <p className="whitespace-pre-wrap wrap-break-word">
          <FormattedText text={text} />
          <span className="stream-cursor ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-[#111b21]" />
        </p>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div data-typing="true" className="wa-bubble-in flex justify-start px-2.5">
      <div className="relative flex items-center gap-1 rounded-lg rounded-tl-none bg-white px-3 py-2 shadow-sm">
        <span
          aria-hidden
          className="absolute -left-1.5 top-0 h-2.5 w-2.5 bg-white [clip-path:polygon(100%_0,0_0,100%_100%)]"
        />
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-[#9aa5ab]"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
