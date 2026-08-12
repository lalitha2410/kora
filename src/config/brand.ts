import type { AbandonedCart } from '../types';
import { carts } from '../data/carts';

export interface BrandColors {
  /** Main brand colour — WhatsApp-style sent bubble, buttons. Chat-panel only;
   * the dashboard deliberately does NOT lean on this one so the two panels
   * don't read as the same product in a different accent. */
  primary: string;
  primaryDark: string;
  /** Light tint used for subtle backgrounds/badges. */
  tint: string;
  /**
   * Dashboard-only palette. Deliberately NOT a continuation of Kora's warm
   * undyed-cotton/sage/clay identity — a warm-toned dashboard sitting next
   * to a warm-toned returns console (Vastra) reads as the same product with
   * a different accent, which is the opposite of what two side-by-side demo
   * products should do. This is a cool, near-neutral analytics register
   * instead: `ink`/`inkRaised` are cool near-black slate (not brown), `paper`
   * is nearly-white text-on-dark, and `accent` is the ONE saturated color in
   * the whole panel — used sparingly, only for the funnel bars, the two hero
   * numbers, and small "live" indicators. Every other surface and every
   * other piece of text in the dashboard is neutral grey or near-white.
   */
  ink: string;
  inkRaised: string;
  paper: string;
  accent: string;
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
    primary: '#7C8B6F',
    primaryDark: '#5C6950',
    tint: '#F3F1E9',
    ink: '#121417',
    inkRaised: '#1B1E24',
    paper: '#F4F5F7',
    accent: '#34D399',
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
