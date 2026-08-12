import type { AbandonedCart } from '../types';
import { carts } from '../data/carts';

export interface BrandColors {
  /**
   * ONE accent, used everywhere in the app that isn't authentic WhatsApp
   * chrome — the dashboard (funnel bars, hero numbers, status pills) AND
   * the chat panel's own UI (avatar circle, send button, header badge,
   * the top bar's logo mark, the intro modal's button, the mobile tab
   * indicator).
   *
   * This used to be split: a separate `primary` (sage green) for
   * "chat-panel chrome" and `accent` (rose) for "dashboard only," on the
   * reasoning that a shared accent would make the two panels "read as the
   * same product." Found live: that reasoning was backwards. The two
   * panels already read as the same product structurally (same light
   * background register, same card language) — a DIFFERENT accent for the
   * chat panel's avatar/send-button just looked like an unrelated color
   * left over from a different design, which is what actually made the
   * panels feel disconnected. The one thing that must stay authentic no
   * matter what is the message BUBBLES themselves (green outgoing, white
   * incoming, double ticks) — those are hardcoded real WhatsApp colours in
   * ChatBubble.tsx, deliberately never wired to any brand color at all, so
   * this whole accent-unification change can't touch them even by
   * accident.
   *
   * Dashboard-only palette otherwise. Deliberately NOT a continuation of
   * Kora's warm undyed-cotton/sage/clay identity — a warm-toned dashboard
   * sitting next to a warm-toned returns console (Vastra) reads as the
   * same product with a different accent, which is the opposite of what
   * two side-by-side demo products should do.
   *
   * LIGHT panel, on purpose (this went through a dark-panel iteration
   * first — found live: a near-black dashboard next to the bright WhatsApp
   * panel created a hard visual break, the screen read as two separate
   * apps rather than one demo. Vastra's returns console works precisely
   * because both its panels are light, so the whole screen reads as one
   * product — Kora now follows the same structural principle, staying
   * distinct through hue/accent, not through going dark). `paper` is the
   * page background (a near-neutral off-white, never cream — cream is
   * Vastra's register), `paperRaised` is the white card surface every
   * block (hero cards, funnel, table) sits on, `ink` is the primary dark
   * text color, and `accent` is the ONE saturated color in the whole
   * panel — used sparingly, only for the funnel bars, the two hero
   * numbers, small "live" indicators, and status pills. Every other piece
   * of text in the dashboard is `ink` at reduced opacity (a muted grey)
   * or plain `ink`.
   *
   * `paper` started as a more visibly rose-tinted off-white
   * (`#F7F2F3`) — next to the WhatsApp panel's own cooler greys (its
   * header/input bars are `#f0f2f5`), the two sides read as slightly
   * different temperature families rather than one demo. Nudged to a
   * near-neutral `#F5F4F5` instead — barely perceptible on its own, but
   * enough that both panels now sit in the same cool-neutral register,
   * the same way Vastra pairs a cream chat panel with a white console.
   * `accent`/`accentDark` deliberately untouched — the temperature fix is
   * in the neutral base, not the brand color.
   *
   * `accent` was originally a bright mint/emerald (`#34D399`) — close enough
   * to a teal wellness-brand accent (WellNest, the sibling returns demo's
   * pharmacy client) that the two apps read as variations on the same
   * palette rather than distinct products. Replaced with a muted dusty
   * rose: warm enough to feel like a contemporary fashion label's lookbook,
   * but nowhere near Vastra's warm beige/rust (that's an orange-brown hue,
   * this sits on the pink/magenta side of the wheel) or WellNest's teal
   * (blue-green, the opposite side of the wheel entirely).
   *
   * `accent` itself (`#C97C88`) is too light to pass text contrast against
   * a near-white card or to sit under white text/icons — it's tuned
   * instead for FILLS specifically paired with DARK text on top: funnel
   * bars with `ink` text, accent-tinted washes behind status pills. Every
   * other use — WHITE text/icons on a colored fill (the chat avatar, the
   * send button, the top-bar logo mark, the intro modal's button) or the
   * accent hue used directly AS text/border on a light background (the
   * mobile tab indicator) — needs `accentDark` instead: same hue, ~350°,
   * darkened for contrast (~9.5:1 against `paperRaised`/white, ~5.8:1
   * against `ink`-adjacent tones, comfortably past WCAG AA in every
   * pairing that actually occurs in this app).
   */
  ink: string;
  paper: string;
  /** White/near-white card surface — hero cards, the funnel card, the
   * secondary-stats strip, and the outcomes table all sit on this,
   * slightly lifted off the tinted `paper` page background beneath them. */
  paperRaised: string;
  accent: string;
  /** A darker shade of `accent`, same hue family, for TEXT/ICONS that need
   * to read clearly against a light OR colored surface — the two hero
   * numbers, status pill labels, the "Mark as paid" button, the
   * items-badge open state, and now every piece of chat-panel/top-bar
   * chrome that puts white on a fill (avatar, send button, logo mark,
   * intro-modal button) or puts the accent hue directly on white (the
   * mobile tab indicator). `accent` itself is chosen light enough to work
   * as bar fills (dark `ink` text sits on top of it) but that makes it too
   * light for either of those — this is that same brand hue, darkened for
   * the opposite context, so every pairing changes together whenever
   * `accent` does, instead of every component guessing a complementary
   * shade on its own. */
  accentDark: string;
  /**
   * The chat panel's wallpaper background — NOT the message bubbles
   * (those are hardcoded real WhatsApp colours in ChatBubble.tsx,
   * deliberately untouched by brand config at all) but the tiled
   * background behind them. Started as `#ece5dd`, a fairly saturated warm
   * beige — next to the dashboard's now near-neutral `paper`, the two
   * panels read as slightly different temperature families. Nudged a
   * little cooler/lighter, blended toward `paper`, so both sides sit in
   * the same register without the wallpaper losing its own warm WhatsApp
   * character entirely — a small, deliberate move, not a full match.
   */
  chatWallpaper: string;
}

/**
 * Brand identity, isolated from everything else so re-pointing this demo at
 * a different D2C brand is "write a new BrandConfig", not "touch the agent,
 * the tools, or the UI". `catalog` here is the campaign's abandoned-cart
 * list (same naming Vastra uses for its orders array) — the product catalog
 * itself lives in data/catalog.ts since carts reference products, not the
 * other way round.
 */
export interface BrandConfig {
  id: string;
  name: string;
  vertical: string;
  /** Short text mark rendered in place of a real logo image. */
  logoMark: string;
  colors: BrandColors;
  agentName: string;
  /** Free-text tone description injected into the agent's system instruction. */
  tone: string;
  waNumber: string;
  /**
   * The ONLY contact details the agent is allowed to hand out — see
   * systemPrompt.ts's CONTACT DETAILS rule. Exists so "how do I reach a
   * human" has a real, code-owned answer instead of the model inventing an
   * email address or toll-free number under pressure. If a field isn't
   * here, the agent has no channel for it and must say so plainly.
   */
  supportEmail: string;
  supportPhone: string;
  supportHours: string;
  /**
   * The ONLY source of a checkout link's domain/path — tools.ts's
   * createCheckoutLinkTool builds every real link from this, never a
   * hardcoded string. Found live: a reply contained
   * "https://wearkora.example/checkout?cart=CART-008" — plausible-looking
   * (wearkora.example is genuinely this brand's support-email domain) but
   * entirely invented, because the model narrated a link instead of
   * calling createCheckoutLink at all. Centralizing the real format here
   * doesn't stop a model from inventing one — see
   * useCartRecoveryAgent.ts's looksLikeFabricatedCheckoutLink for the
   * code-level guard against that — but it does mean there is exactly one
   * place that knows what a REAL link looks like, so the guard has
   * something authoritative to check against.
   */
  checkoutBaseUrl: string;
  catalog: AbandonedCart[];
}

export const koraBrand: BrandConfig = {
  id: 'kora',
  name: 'Kora',
  vertical: 'Fashion & Apparel (D2C)',
  logoMark: 'K',
  colors: {
    ink: '#1E1417',
    paper: '#F5F4F5',
    paperRaised: '#FFFFFF',
    accent: '#C97C88',
    accentDark: '#7A2A38',
    chatWallpaper: '#EDE8E2',
  },
  agentName: 'Meera',
  tone:
    'warm but unhurried, like a helpful store associate who respects a "no" the first time — never pushy, ' +
    'never uses urgency language that isn\'t true. Short, natural sentences, like a real WhatsApp message.',
  waNumber: '+91 98200 44556',
  supportEmail: 'hello@wearkora.example',
  supportPhone: '+91 98200 44560',
  supportHours: 'Mon–Sat, 10am–7pm IST',
  checkoutBaseUrl: 'https://kora.in/checkout',
  catalog: carts,
};

export const brands: BrandConfig[] = [koraBrand];
