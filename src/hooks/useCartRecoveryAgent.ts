import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import { koraBrand } from '../config/brand';
import type { AbandonedCart, CampaignType, CartLineItem, CartOutcome, ChatMessage, LlmSettableOutcome, ProductImage } from '../types';
import {
  getActiveProvider,
  hasApiKey,
  newChatSession,
  resetProviderFallback,
  sendAgentMessage,
  type ChatSession,
  type ToolExecutorMap,
} from '../lib/llmProvider';
import { buildSystemInstruction } from '../lib/systemPrompt';
import {
  checkDiscountEligibilityTool,
  createCheckoutLinkTool,
  findAlternativesByBudgetTool,
  findAlternativesByColourTool,
  findAlternativesBySizeTool,
  findSimilarItemsTool,
  generateDiscountCodeTool,
  getActiveSalesTool,
  getBrowseAbandonmentTool,
  getCartDetailsTool,
  getRecommendationsFromHistoryTool,
  markCartOutcomeTool,
  markCartPaidTool,
  removeCartItemTool,
  selectAlternativeTool,
} from '../lib/tools';
import { amountPaidForCart, resolveCart } from '../lib/pricingPolicy';
import { getCatalogItem } from '../data/catalog';
import { productImageCaption, productImageFor } from '../lib/productImages';
import type { Scenario } from '../data/scenarios';

/**
 * One agent, N independent conversations — one per abandoned cart, unlike
 * Vastra's one-conversation-per-channel model. Every cart already "went
 * out" as part of the campaign (see buildInitialThreads/buildInitialSessions
 * below: the authored opening message is seeded into every cart's thread
 * and into the model's own transcript at load, no LLM call involved) — only
 * the customer's replies happen live, whichever cart the presenter is
 * currently looking at.
 *
 * State is split the same way Vastra splits tickets vs. per-channel
 * transcripts: `carts` is the one shared backend the campaign dashboard
 * reads, `threads` is per-cart UI/session state, and `factsRef` (below) is
 * per-cart conversational memory — ported from Vastra's `ConversationFacts`
 * fact-tracking state machine, adapted to this domain. Switching
 * `activeCartId` is a pure view change — it never touches any of them.
 */

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  getCartDetails: 'Looking up cart details…',
  checkDiscountEligibility: 'Checking discount eligibility…',
  generateDiscountCode: 'Generating discount code…',
  findSimilarItems: 'Searching similar items…',
  findAlternativesBySize: 'Checking size availability…',
  findAlternativesByBudget: 'Searching within budget…',
  findAlternativesByColour: 'Searching other colours…',
  getActiveSales: 'Checking active sales…',
  selectAlternative: 'Updating cart to your pick…',
  removeCartItem: 'Updating cart to what you want…',
  createCheckoutLink: 'Creating checkout link…',
  markCartOutcome: 'Updating cart outcome…',
  getRecommendationsFromHistory: 'Finding recommendations…',
  getBrowseAbandonment: 'Checking browsing history…',
};

const THINKING_LABEL = 'Reading customer reply…';

interface ThreadState {
  messages: ChatMessage[];
  isTyping: boolean;
  toolActivity: string | null;
  streamingText: string;
}

function buildInitialThreads(catalog: AbandonedCart[], productBaseUrl: string): Record<string, ThreadState> {
  const out: Record<string, ThreadState> = {};
  for (const cart of catalog) {
    // The opening message is authored copy that already names this cart's
    // own item (see data/carts.ts) — attaching its real catalog image here
    // is the one place an image is set outside a live tool call, and it's
    // still built the same way (productImageFor, never invented).
    const openingImage = cart.items[0] ? productImageFor(cart.items[0].itemId, productBaseUrl) : undefined;
    out[cart.cartId] = {
      messages: [
        { id: uid(), role: 'agent', text: cart.openingMessage, timestamp: cart.abandonedAt + 1000, image: openingImage },
      ],
      isTyping: false,
      toolActivity: null,
      streamingText: '',
    };
  }
  return out;
}

/** Seeds each cart's own ChatSession with the authored opening message as
 * the model's first turn — not just shown in the UI, but genuinely part of
 * the transcript the model reasons over, so an objection like "it's too
 * expensive" has an antecedent the model actually knows about. */
function buildInitialSessions(brand: BrandConfig, catalog: AbandonedCart[]): Record<string, ChatSession> {
  const out: Record<string, ChatSession> = {};
  for (const cart of catalog) {
    const session = newChatSession(buildSystemInstruction(brand, cart));
    session.messages.push({ role: 'assistant', content: cart.openingMessage });
    out[cart.cartId] = session;
  }
  return out;
}

// ---------------------------------------------------------------------
// Conversation fact-tracking state machine — ported from Vastra's
// useReturnAgent.ts (ConversationFacts/FLOW/currentPendingQuestion), which
// was built after the same class of bug recurred repeatedly there: the
// model re-asking for something already known, or re-listing options
// already presented, once the details fell out of the bounded context
// window (see llmProvider.ts's buildRequestMessages). `facts` is the single
// source of truth for what THIS cart's conversation has already
// established; nothing else independently tracks it, so it can't drift out
// of sync with itself the way three separate one-off guards eventually did
// in Vastra's history.
//
// The domain is different from Vastra's return wizard (order -> item ->
// eligibility -> reason -> size -> slot -> ticket, a fairly rigid
// sequence), so the shape here is lighter: cart-recovery is objection
// handling, not a linear intake form. The one place a numbered list truly
// appears is the five alternative-finding tools (findSimilarItems,
// findAlternativesBySize/ByBudget/ByColour, getActiveSales) — whichever one
// last returned a non-empty item list arms `pendingOptions`, and that's the
// only "pending question" this state machine tracks.
// ---------------------------------------------------------------------

interface PendingOptions {
  /** Which tool produced this list — forced again by the guardrail if the
   * model tries to fabricate a reply instead of calling it. */
  tool: string;
  items: { itemId: string; name: string; price: number }[];
  /** True once the CUSTOMER-VISIBLE reply for the turn that populated this
   * actually named at least one of these items — not just that the tool
   * call succeeded. Found live: a price-justification reply's tool call
   * (getActiveSales) populated this internally, but the reply text itself
   * never mentioned the alternative to the customer — yet a later bare
   * "ok" (acknowledging the justification, not an alternative that was
   * never shown) still got treated as accepting it, because
   * currentPendingQuestion only checked whether items existed, not
   * whether the customer was ever actually told about them. Starts false
   * the instant the tool succeeds; set true only by
   * markPendingOptionsPresented, called once the turn's actual final
   * reply text is known. */
  presented: boolean;
}

interface ConversationFacts {
  cartDetailsChecked?: boolean;
  /** Distinctive words drawn from THIS cart's item name + fabric text, the
   * moment getCartDetails actually returns them — see
   * extractJustificationTerms and looksLikeMissingPriceJustification. The
   * one thing a "not discountable" reply is allowed to justify itself
   * with; grounding the check in the item's own real data (not a fixed
   * generic word list) is what makes it verify something TRUE about this
   * item rather than just the presence of vaguely craft-sounding words. */
  itemJustificationTerms?: string[];
  discountEligibilityChecked?: boolean;
  discountEligible?: boolean;
  discountMaxPercent?: number;
  discountOffered?: boolean;
  discountPercent?: number;
  discountCode?: string;
  pendingOptions?: PendingOptions;
  /** True once ANY alternative-finding tool's results have actually been
   * shown to the customer in a reply, ever, this conversation — not just
   * that a tool succeeded. Unlike pendingOptions.presented (which is
   * cleared the moment a selection is captured), this persists for the
   * rest of the conversation, so selectAlternative's own hard-backstop
   * check (see buildExecutors) can still verify presentation genuinely
   * happened even after facts.pendingOptions itself is gone by the time
   * selectAlternative actually runs. */
  anyAlternativePresented?: boolean;
  selectedAlternativeItemId?: string;
  selectedAlternativeName?: string;
  /** True once selectAlternative has actually run for the CURRENT
   * selectedAlternativeItemId — see requiredAlternativeSelectionTool. A
   * selection captured from the customer's numbered reply (captureNextReply)
   * is a code-level fact the moment it's captured, but the cart's own
   * `items` array doesn't change until the tool actually runs; this tracks
   * that gap so it can be forced closed before anything else happens. */
  alternativeSelectionApplied?: boolean;
  /** Set by resolvePartialCartRemoval the moment free text unambiguously
   * identifies which line of a MULTI-ITEM cart the customer wants dropped
   * — e.g. "I only want the co-ord set, not the top." Resolved in code
   * from the cart's own real items, never trusted from the model's own
   * argument alone — same "a captured selection wins over a hallucinated
   * argument" rule selectedAlternativeItemId already follows. Holds the
   * itemId to REMOVE. */
  pendingCartItemRemoval?: string;
  pendingCartItemRemovalName?: string;
  /** True once removeCartItem has actually run for the CURRENT
   * pendingCartItemRemoval — see requiredCartItemRemovalTool. Same gap as
   * alternativeSelectionApplied: the code knows what the customer wants
   * dropped before the cart's own `items` array actually reflects it. */
  cartItemRemovalApplied?: boolean;
  checkoutLinkCreated?: boolean;
  checkoutLink?: string;
  outcomeSet?: CartOutcome;
  /** Trigger 2's fact-lookup flag — same "don't re-fetch/re-ask" purpose
   * as cartDetailsChecked above, just for the one profile-driven tool that
   * isn't part of the original checkout FLOW. Recommendations (Trigger 1)
   * need no flag of their own: getRecommendationsFromHistory is in
   * ALTERNATIVE_TOOLS, so it already populates pendingOptions exactly like
   * findSimilarItems/getActiveSales do. */
  browseAbandonmentChecked?: boolean;
  /** Every real INR amount this conversation has actually seen from a tool
   * result (or from the customer's own stated budget) — cart items, cart
   * value, alternatives, checkout/reorder amounts. Never cleared, since a
   * price established several turns ago is still real several turns
   * later. See recordPrice and looksLikeFabricatedPriceClaim: a ₹ figure
   * in a reply that isn't in this list (or derivable from it — see
   * buildAllowedPriceSet) is treated as invented. */
  knownPrices?: number[];
  /** Every real discount percentage this conversation has actually seen
   * from checkDiscountEligibility/generateDiscountCode. See recordPercent
   * and looksLikeFabricatedDiscountClaim. */
  knownPercents?: number[];
  /** True once getCartDetails has reported AT LEAST ONE of this cart's own
   * line items as genuinely in stock (sizeInStock: true) — see
   * looksLikeFabricatedAvailabilityClaim. Never cleared once set. */
  cartAnyItemInStock?: boolean;
  /** True once getCartDetails has reported AT LEAST ONE of this cart's own
   * line items as genuinely NOT in stock (sizeInStock: false). */
  cartAnyItemOutOfStock?: boolean;
}

type PendingQuestion = 'alternativeChoice';

/** The only open question this state machine tracks — derived fresh from
 * `facts` every time, never stored, so it can never say "still pending"
 * about something `facts` already has an answer for (see
 * captureNextReply, which is what clears it). */
function currentPendingQuestion(f: ConversationFacts): PendingQuestion | undefined {
  // presented: false means the tool call succeeded but the customer was
  // never actually shown these items — see PendingOptions.presented's own
  // comment. Nothing is "pending" for the customer to answer until they've
  // actually been asked.
  if (f.pendingOptions?.presented && f.pendingOptions.items.length > 0 && !f.selectedAlternativeItemId) {
    return 'alternativeChoice';
  }
  return undefined;
}

interface FlowStep {
  id: 'details' | 'eligibility' | 'discount' | 'checkout' | 'outcome';
  label: string;
  applies: (f: ConversationFacts) => boolean;
  done: (f: ConversationFacts) => boolean;
  tools: string[];
}

/** Each step's `done` is a pure function of `facts` — the ONLY place that
 * decides whether a step is complete. `tools` is used solely by
 * checkForRedundantStep below (requirement: fail loudly if the agent
 * re-does a step it already finished), not for control flow — nothing here
 * blocks a tool call; tools.ts's own guards already do that. This is the
 * visibility layer on top. */
const FLOW: FlowStep[] = [
  {
    id: 'details',
    label: 'cart details already fetched',
    applies: () => true,
    done: (f) => Boolean(f.cartDetailsChecked),
    tools: ['getCartDetails'],
  },
  {
    id: 'eligibility',
    label: 'discount eligibility already checked',
    applies: () => true,
    done: (f) => Boolean(f.discountEligibilityChecked),
    tools: ['checkDiscountEligibility'],
  },
  {
    id: 'discount',
    label: 'a discount code already generated for this cart',
    applies: (f) => f.discountEligible === true,
    done: (f) => Boolean(f.discountOffered),
    tools: ['generateDiscountCode'],
  },
  {
    id: 'checkout',
    label: 'a checkout link already created for this cart',
    applies: () => true,
    done: (f) => Boolean(f.checkoutLinkCreated),
    tools: ['createCheckoutLink'],
  },
  {
    id: 'outcome',
    label: 'a final outcome already recorded for this cart',
    applies: () => true,
    done: (f) => Boolean(f.outcomeSet),
    tools: ['markCartOutcome'],
  },
];

/**
 * True for text that reads like a numbered options list (2+ list markers —
 * either the emoji numerals the prompt asks for, or a plain "1." style
 * fallback) — the shape an alternatives/sales answer always takes, and NOT
 * the shape most other replies take. Deliberately generic (doesn't know or
 * care whether the list is sizes, colours, budget matches, or sale items) —
 * the caller already knows which tool is pending, this only answers "does
 * this text look like *a* list."
 */
const OPTION_MARKER_PATTERN = /[1-9]️?⃣|\b[1-9]\./g;

/**
 * True when a reply's numbered list contains an entry that doesn't
 * correspond to a REAL item from the tool result it's supposed to
 * represent — by COUNT (more markers than real items exist) or by
 * IDENTITY (a marker whose text doesn't genuinely describe any real item).
 * Found live, CART-008: findSimilarItems returned exactly one real item
 * (Clay Hand Block-Print Midi Dress, ₹2799), and the reply presented it
 * alongside a fully invented second product — "Linen Relaxed Fit Shirt —
 * ₹2299" — a catalog item that has never existed. This replaced two
 * narrower, count-only predecessors (looksLikeFabricatedOptionsList,
 * looksLikePaddedOptionsList) that could only catch a numbered list
 * outnumbering the real items, never a list that stayed the RIGHT length
 * but swapped in a wrong or invented entry — the exact shape of this bug,
 * since the reply's 2 markers happened to match a plausible expectation
 * even though only 1 of those 2 entries was real.
 *
 * Deliberately counts how many REAL items are genuinely described in the
 * text (repliesGenuinelyDescribe, word-overlap — resistant to the same
 * paraphrasing/Unicode-dash noise the image-attachment matching already
 * had to survive) rather than trying to parse which text span belongs to
 * which marker — parsing free-form list formatting reliably is far more
 * fragile than just asking "how many of the real items does this text
 * actually, genuinely talk about," which is exactly the number that must
 * equal the marker count for every marker to be a real, selectable option.
 * If markers outnumber genuinely-described real items — whether because
 * the list is too long, or because one entry describes something that
 * isn't real — that's a customer looking at a numbered option that leads
 * nowhere if they pick it. A single marker is exempted (a lone reference
 * to "1." in prose isn't a list at all) — this only ever fires on a
 * genuine multi-entry list, same threshold every other list-shaped check
 * in this file uses.
 */
function looksLikeFabricatedProductInList(content: string, facts: ConversationFacts): boolean {
  const markers = content.match(OPTION_MARKER_PATTERN) ?? [];
  if (markers.length < 2) return false;
  const items = facts.pendingOptions?.items ?? [];
  const genuineCount = items.filter((it) => repliesGenuinelyDescribe(content, it.name)).length;
  return markers.length > genuineCount;
}

/**
 * Which tool re-grounds the model after a fabricated product-list entry —
 * whichever tool actually produced the real items (so the model sees the
 * genuine, short list again), or getCartDetails as a safe fallback on the
 * rarer case where the list was invented from nothing, with no real tool
 * call behind it at all.
 */
function requiredProductListCorrectionTool(content: string, facts: ConversationFacts): string | undefined {
  if (!looksLikeFabricatedProductInList(content, facts)) return undefined;
  return facts.pendingOptions?.tool ?? 'getCartDetails';
}

/**
 * Deterministic (not LLM-judged) heuristic for "this message is a price
 * objection" — same class of check as looksLikeFabricatedOptionsList: a
 * pattern on the RAW TEXT, not a judgment call left to the model. Found
 * live: the agent called getCartDetails after "it's a bit too expensive",
 * then just narrated the cart back ("Got it — the kurta is still in your
 * cart.") and stopped — never called checkDiscountEligibility, never
 * offered anything. Telling the model "always check eligibility on a price
 * objection" in the system prompt is necessary but not sufficient, same
 * conclusion as every other guard in this app; see buildTurnGuardrail.
 */
const PRICE_OBJECTION_PATTERN =
  /\b(expensive|pricey|pricier|price|cost(?:s|ly)?|afford(?:able)?|discount|cheaper|too much|overpriced|budget)\b/i;

function looksLikePriceObjection(text: string): boolean {
  return PRICE_OBJECTION_PATTERN.test(text);
}

/** Alternative-finding tools that actually address a PRICE objection —
 * size/colour alternatives don't (a cheaper size-swap isn't "handling"
 * being told something's too expensive), so offering one of those doesn't
 * excuse skipping the eligibility check. */
const PRICE_RELEVANT_ALTERNATIVE_TOOLS = new Set(['getActiveSales', 'findAlternativesByBudget', 'findSimilarItems']);

/**
 * True once this conversation has actually addressed a price objection.
 * Deliberately NOT satisfied by "eligibility was checked" alone — found
 * live: eligible:true, checkDiscountEligibility genuinely called, and the
 * final reply was still just "Got it — that makes sense," with
 * generateDiscountCode never called and no code ever offered. Checking
 * eligibility is step one, not the finish line; an eligible cart isn't
 * "handled" until a code actually exists, and an ineligible one IS handled
 * the moment that's known (there's nothing further to generate — the
 * explanation is the resolution). A price-relevant alternative just being
 * offered instead (the sale-aware path, which legitimately never calls
 * checkDiscountEligibility at all) also counts as handled.
 */
function priceObjectionAlreadyHandled(facts: ConversationFacts): boolean {
  if (facts.pendingOptions && PRICE_RELEVANT_ALTERNATIVE_TOOLS.has(facts.pendingOptions.tool)) return true;
  if (!facts.discountEligibilityChecked) return false;
  if (facts.discountEligible === false) return true;
  return Boolean(facts.discountOffered);
}

/** Which tool must run next to move an unresolved price objection
 * forward, or undefined if priceObjectionAlreadyHandled(facts) is already
 * true. Shared by both enforcement layers below (buildInitialForcedTool
 * and buildTurnGuardrail) so "what's missing" is decided in exactly one
 * place — the two layers would silently drift apart otherwise. */
function requiredPriceObjectionTool(facts: ConversationFacts): string | undefined {
  if (priceObjectionAlreadyHandled(facts)) return undefined;
  // Found live: the model can and does jump straight to
  // checkDiscountEligibility/findSimilarItems on a price objection without
  // ever calling getCartDetails first — which means
  // facts.itemJustificationTerms never gets populated (see updateFacts),
  // and looksLikeMissingPriceJustification has nothing to check the reply
  // against, so a real justification requirement silently goes
  // unenforced. Forcing getCartDetails first whenever it's still missing
  // guarantees the fabric/name data this item's price justification has to
  // cite actually exists by the time a decline reply is possible — also
  // just the system prompt's own "FACTS FIRST" rule, now guaranteed rather
  // than requested.
  if (!facts.cartDetailsChecked) return 'getCartDetails';
  // Eligibility already known and favorable, just never acted on -> the
  // missing step is generating the code, not re-checking eligibility
  // (checkDiscountEligibility would just be a no-op repeat). Otherwise
  // eligibility itself hasn't been established yet.
  return facts.discountEligibilityChecked && facts.discountEligible ? 'generateDiscountCode' : 'checkDiscountEligibility';
}

/** Loose "the customer was actually told no" signal — paired with
 * facts.discountEligible === false in looksLikePriceObjectionNonAnswer
 * below, since "ineligible" is a known fact the moment checkDiscountEligibility
 * returns, but that fact alone doesn't mean the REPLY said so (found live:
 * eligible:false, genuinely checked, final reply was "Got it." with no
 * mention of a discount either way). */
const DISCOUNT_DECLINE_PATTERN =
  /\b(unfortunately|can'?t offer|cannot offer|couldn'?t offer|no (?:additional )?discount|not eligible|isn'?t eligible|doesn'?t qualify|no discount (?:is )?available)\b/i;

/**
 * True when a price objection is on the table and the reply does nothing to
 * resolve it — no discount decision (a code actually offered, or an
 * explicit decline) and no real alternative mentioned by name. Backstop for
 * the gap found live on CART-008: every tool the objection needed had
 * already run — checkDiscountEligibility (ineligible, margin floor) AND
 * getActiveSales (found a genuine cheaper alternative) — so
 * priceObjectionAlreadyHandled(facts) was already true and
 * requiredPriceObjectionTool forced nothing further. But the model's actual
 * reply was "Got it." on one turn and a paragraph about fabric on the next
 * — the customer was never told the discount was declined, and the
 * alternative already sitting in facts.pendingOptions was never surfaced.
 * Fact-state saying "handled" is not proof the CUSTOMER was told anything;
 * this checks what the reply itself says. Deliberately independent of
 * priceObjectionAlreadyHandled/requiredPriceObjectionTool so it still fires
 * once those consider the objection resolved — that's exactly the case it
 * exists to catch, not a redundant recheck of the same condition.
 */
function looksLikePriceObjectionNonAnswer(content: string, facts: ConversationFacts): boolean {
  const hasDiscountDecision =
    (Boolean(facts.discountCode) && content.includes(facts.discountCode as string)) ||
    (facts.discountEligible === false && DISCOUNT_DECLINE_PATTERN.test(content));
  if (hasDiscountDecision) return false;

  // Deliberately requires a REAL item to be genuinely described — "looks
  // like a numbered list" used to count on its own here too, which is
  // exactly the loophole that let a fabricated list read as "handled":
  // shaped like an answer, containing zero real options. See
  // looksLikeFabricatedProductInList, checked separately (and earlier) for
  // that exact failure — this check only needs to know whether the reply
  // genuinely engaged with something real.
  const pendingItems = facts.pendingOptions?.items ?? [];
  const mentionsAlternative = pendingItems.some((item) => repliesGenuinelyDescribe(content, item.name));
  if (mentionsAlternative) return false;

  return true;
}

/**
 * True when the item is genuinely not discountable (checkDiscountEligibility
 * already ran and said so) and the reply skips straight to an alternative
 * without ever justifying the original price from this item's own real
 * attributes. Found live: "Sure thing! Here's a similar dress that's on
 * sale right now:" — a real alternative, correctly sourced, but the
 * customer was never told WHY the original item costs what it does before
 * being steered toward something cheaper, which is exactly the "fine,
 * here's something worse" framing the brand doesn't want. The prompt rule
 * asking for this (systemPrompt.ts's OBJECTIONS section) is necessary but
 * not sufficient on a weak enough model, same conclusion as every other
 * guard in this file — this is the structural backstop.
 *
 * Deliberately checked against facts.itemJustificationTerms — words drawn
 * from THIS item's own name/fabric via getCartDetails, never a generic
 * "sounds handmade" word list — so a reply can only pass by citing
 * something actually true about this specific product, per the explicit
 * requirement that the justification "must come from real product data,
 * never invented." Returns false (nothing to check yet) if
 * getCartDetails hasn't run this conversation — that gap is
 * requiredPriceObjectionTool's job to force, not this one's.
 */
function looksLikeMissingPriceJustification(content: string, facts: ConversationFacts): boolean {
  if (facts.discountEligible !== false) return false;
  const terms = facts.itemJustificationTerms ?? [];
  if (terms.length === 0) return false;
  const lowerContent = content.toLowerCase();
  return !terms.some((term) => lowerContent.includes(term));
}

const URL_PATTERN = /https?:\/\/\S+/gi;

/**
 * True when a reply contains a URL that isn't the REAL checkout link this
 * conversation actually has (or contains any URL at all when there is no
 * real one yet). Found live: a reply contained
 * "https://wearkora.example/checkout?cart=CART-008" — a plausible but
 * entirely invented link (wearkora.example happens to be this brand's real
 * support-email domain, which the model had already seen in its own
 * system prompt) — because the model narrated a link instead of actually
 * calling createCheckoutLink. VERBATIM TOOL DATA is a prompt rule; this is
 * the code-level backstop for the one piece of tool output where inventing
 * a plausible-looking value is actively harmful (a customer could click
 * it). Trailing punctuation is stripped before comparing since a URL at
 * the end of a sentence commonly picks up a period.
 */
function looksLikeFabricatedCheckoutLink(content: string, facts: ConversationFacts): boolean {
  const urls = (content.match(URL_PATTERN) ?? []).map((u) => u.replace(/[).,!?]+$/, ''));
  if (urls.length === 0) return false;
  const real = facts.checkoutLink;
  if (!real) return true;
  return !urls.includes(real);
}

// ---------------------------------------------------------------------
// CLAIM GUARD — found live: a reply quoted "₹3,290" for a cart whose real
// value (getCartDetails' own return) was ₹4,499 — an entirely invented
// number, no tool behind it — and separately, a different reply claimed a
// size "isn't available" for an item whose getCartDetails result had
// already said sizeInStock: true. Both are exactly the class of harm this
// whole guardrail file exists to prevent — a customer acting on a price or
// availability claim the brand never actually confirmed — worse than any
// of the other fabrication classes already guarded against here, since a
// customer could act on it directly (pay the wrong amount, give up on an
// item that was actually available). recordPrice/recordPercent below are
// called from updateFacts, for every tool result that ever returns a real
// amount/percentage, so facts.knownPrices/knownPercents accumulate the
// full set of numbers a reply is ever allowed to state — never cleared,
// since a price established several turns ago is still real several turns
// later.
// ---------------------------------------------------------------------

function recordPrice(facts: ConversationFacts, price: number | undefined): void {
  if (price === undefined || !Number.isFinite(price)) return;
  facts.knownPrices = facts.knownPrices ?? [];
  if (!facts.knownPrices.includes(price)) facts.knownPrices.push(price);
}

function recordPercent(facts: ConversationFacts, percent: number | undefined): void {
  if (percent === undefined || !Number.isFinite(percent)) return;
  facts.knownPercents = facts.knownPercents ?? [];
  if (!facts.knownPercents.includes(percent)) facts.knownPercents.push(percent);
}

const RUPEE_CLAIM_PATTERN = /₹\s?([\d,]+(?:\.\d+)?)/g;

/**
 * The real, tool-confirmed prices a reply is allowed to state, PLUS every
 * price directly derivable from them — the discounted price and the
 * savings amount for every known (price, percent) pair actually seen this
 * conversation. Without the derived values, a perfectly correct "with 10%
 * off, that's ₹1664" would trip the guard just as hard as a genuinely
 * invented number, since no single tool call ever returns a pre-computed
 * discounted total. Recomputed fresh each check (not cached in facts) —
 * cheap, and always consistent with whatever knownPrices/knownPercents
 * currently hold.
 */
function buildAllowedPriceSet(facts: ConversationFacts): Set<number> {
  const prices = facts.knownPrices ?? [];
  const percents = facts.knownPercents ?? [];
  const allowed = new Set<number>(prices);
  for (const p of prices) {
    for (const d of percents) {
      allowed.add(Math.round(p * (1 - d / 100)));
      allowed.add(Math.round((p * d) / 100));
    }
  }
  return allowed;
}

/**
 * True when the reply states a ₹ amount that doesn't match any real price
 * this conversation has actually seen (or a value directly derived from
 * one — see buildAllowedPriceSet). Unconditional, checked on every reply
 * regardless of whether a price objection was ever raised — see this
 * section's own header comment for why a fabricated price is serious
 * enough to warrant that, the same reasoning looksLikeFabricatedCheckoutLink
 * already applies to invented URLs.
 */
function looksLikeFabricatedPriceClaim(content: string, facts: ConversationFacts): boolean {
  const allowed = buildAllowedPriceSet(facts);
  for (const m of content.matchAll(RUPEE_CLAIM_PATTERN)) {
    const value = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(value) && !allowed.has(value)) return true;
  }
  return false;
}

/**
 * True when the reply states a discount percentage that doesn't match
 * checkDiscountEligibility's maxDiscountPercent or generateDiscountCode's
 * own discountPercent, ever returned this conversation. Deliberately
 * scoped to percentages that actually read as a DISCOUNT claim (near
 * "off"/"discount"/"code"/"save") rather than every bare "N%" in the
 * text — this catalog's own fabric descriptions are full of legitimate,
 * unrelated percentages ("100% pure linen", "100% cotton"), which would
 * otherwise false-positive on nearly every reply that quotes fabric
 * details exactly as the OBJECTIONS section asks it to.
 */
function looksLikeFabricatedDiscountClaim(content: string, facts: ConversationFacts): boolean {
  const known = facts.knownPercents ?? [];
  for (const m of content.matchAll(/(\d{1,3})\s?%/g)) {
    const idx = m.index ?? 0;
    const window = content.slice(Math.max(0, idx - 25), Math.min(content.length, idx + m[0].length + 15)).toLowerCase();
    if (!/\b(off|discount|code|save)\b/.test(window)) continue;
    const value = Number(m[1]);
    if (Number.isFinite(value) && !known.includes(value)) return true;
  }
  return false;
}

const NEGATIVE_AVAILABILITY_PATTERN = /\b(isn'?t available|is not available|not currently available|no longer available|out of stock|unavailable|sold out)\b/i;
const POSITIVE_AVAILABILITY_PATTERN = /\b(is available|is in stock|available in your size|currently available|still available|back in stock)\b/i;

/**
 * True when the reply asserts a stock/availability claim about this
 * cart's own item(s) that contradicts what getCartDetails actually
 * reported — found live: "Your size isn't available right now" for a
 * line whose getCartDetails result had already said sizeInStock: true.
 * Deliberately one-directional per branch (a NEGATIVE claim only trips
 * when we know EVERY checked item was actually in stock; a POSITIVE claim
 * only trips when we know something was actually out of stock and nothing
 * was confirmed in stock) — a cart with a genuine mix of in-stock and
 * out-of-stock lines shouldn't false-positive on a reply that correctly
 * describes ONE of them. Scoped to the cart's own items specifically
 * (never alternatives) since findAlternativesBySize/etc. can structurally
 * only ever return items that ARE available — there's no equivalent risk
 * there to guard against.
 */
function looksLikeFabricatedAvailabilityClaim(content: string, facts: ConversationFacts): boolean {
  if (!facts.cartDetailsChecked) return false;
  if (NEGATIVE_AVAILABILITY_PATTERN.test(content) && facts.cartAnyItemInStock && !facts.cartAnyItemOutOfStock) return true;
  if (POSITIVE_AVAILABILITY_PATTERN.test(content) && facts.cartAnyItemOutOfStock && !facts.cartAnyItemInStock) return true;
  return false;
}

/**
 * Combines the three claim checks above into the ONE corrective tool
 * buildTurnGuardrail should force — the single entry point it actually
 * calls. Deliberately NOT a flat boolean re-forcing getCartDetails for
 * every kind of fabrication: found live, forcing getCartDetails to correct
 * a fabricated DISCOUNT PERCENTAGE does nothing useful (getCartDetails
 * doesn't return eligibility/percent data at all), which wastes one of the
 * two guardrail retries on a tool call that can't possibly fix the actual
 * problem — on a weak enough model, that alone was enough to exhaust the
 * retry budget and fall through to the generic "having trouble" apology
 * instead of a corrected answer. A fabricated discount percentage is
 * re-grounded by re-forcing checkDiscountEligibility (the one tool that
 * actually returns the real percentage); a fabricated price or
 * stock/availability claim is re-grounded by getCartDetails, same as
 * before. Checked in this order deliberately: a reply can misstate BOTH a
 * price and a percentage in the same turn, and the percentage is the
 * rarer, more specific mistake worth prioritizing the correction for.
 */
function requiredClaimCorrectionTool(content: string, facts: ConversationFacts): string | undefined {
  if (looksLikeFabricatedDiscountClaim(content, facts)) return 'checkDiscountEligibility';
  if (looksLikeFabricatedPriceClaim(content, facts) || looksLikeFabricatedAvailabilityClaim(content, facts)) return 'getCartDetails';
  return undefined;
}

/**
 * Which tool must run before anything else, when the customer just picked
 * a numbered/named alternative but the cart hasn't actually been swapped to
 * it yet — see ConversationFacts.alternativeSelectionApplied. Checked FIRST
 * in both enforcement layers below, ahead of price-objection handling: a
 * captured selection is the most urgent, deterministic requirement there
 * is (the code already knows exactly what the customer picked; nothing the
 * model says can change that), and found live to matter more than price
 * handling in practice — CART-008's "1" was answered with a vague
 * clarifying question instead of ever swapping the cart, because there was
 * no forced tool telling the model what to do with a selection it had
 * already been told about in the summary alone.
 */
function requiredAlternativeSelectionTool(facts: ConversationFacts): string | undefined {
  return facts.selectedAlternativeItemId && !facts.alternativeSelectionApplied ? 'selectAlternative' : undefined;
}

/**
 * Same priority tier as requiredAlternativeSelectionTool, for the same
 * reason: resolvePartialCartRemoval (below) has already deterministically
 * identified, in code, which line of a multi-item cart the customer wants
 * dropped — nothing the model says can change that, so nothing downstream
 * (pricing, checkout) is trustworthy until removeCartItem has actually run.
 */
function requiredCartItemRemovalTool(facts: ConversationFacts): string | undefined {
  return facts.pendingCartItemRemoval && !facts.cartItemRemovalApplied ? 'removeCartItem' : undefined;
}

/**
 * Proactive enforcement: forces sendAgentMessage's very FIRST round of
 * this turn to call the required tool, before the model has had any
 * chance to reply at all. This is the unconditional half of price-
 * objection handling — reactive detection (buildTurnGuardrail, below) is
 * necessary but was found live to not be SUFFICIENT on its own: it can
 * only correct a reply after generating it, within a bounded retry
 * budget, and depends on the model's own eventual reply actually tripping
 * the check. Requested explicitly after a live regression report: "if a
 * price objection is raised and eligibility has not been checked for the
 * current cart in the current session, the tool call is forced before any
 * reply" — no exceptions, not best-effort.
 */
function buildInitialForcedTool(customerMessage: string, facts: ConversationFacts): string | undefined {
  const selectionTool = requiredAlternativeSelectionTool(facts);
  if (selectionTool) return selectionTool;
  const removalTool = requiredCartItemRemovalTool(facts);
  if (removalTool) return removalTool;
  if (!looksLikePriceObjection(customerMessage)) return undefined;
  return requiredPriceObjectionTool(facts);
}

/**
 * Builds sendAgentMessage's `guardrail` argument for one customer message —
 * the reactive backstop behind buildInitialForcedTool above. Still needed
 * even with the proactive force in place: forcing round 1 guarantees
 * checkDiscountEligibility (or generateDiscountCode, if eligibility was
 * already known) gets called, but doesn't guarantee the model's EVENTUAL
 * final reply actually acts on that result rather than trailing off into
 * unrelated narration a couple of rounds later — this still needs to be
 * caught after the fact. Checked in this order — only one correction per
 * turn:
 *
 *  1. Alternative selected but not yet applied — see
 *     requiredAlternativeSelectionTool. Takes priority over everything
 *     else; nothing downstream (pricing, checkout) is trustworthy while
 *     the cart still points at the wrong item.
 *  1b. Same idea, for a multi-item cart — a partial-removal already
 *     resolved in code but not yet applied (requiredCartItemRemovalTool).
 *     Same priority tier as #1 for the same reason: the cart's contents
 *     are wrong until this runs.
 *  2. Price objection, unresolved — requiredPriceObjectionTool(facts) is
 *     still non-empty AT THE MOMENT THE GUARDRAIL ACTUALLY RUNS (called
 *     inside the returned closure, not hoisted out and captured once:
 *     `facts` is mutable and a multi-provider-fallback turn can run
 *     several rounds before this check point is even reached — evaluating
 *     it once up front risks forcing an already-redundant call one round
 *     too late to matter).
 *  3. Missing price justification — the item is genuinely not
 *     discountable and the reply jumps straight to an alternative without
 *     ever citing this item's own real attributes for why (see
 *     looksLikeMissingPriceJustification). Checked independently of #2/#4
 *     (a reply can correctly decide+offer an alternative and STILL skip
 *     the justification — these are different failures).
 *  4. Non-answer — neither a discount decision nor a real alternative
 *     appears anywhere in the reply at all (see
 *     looksLikePriceObjectionNonAnswer). The catch-all, checked last.
 *
 * Three 0th checks, ahead of all of these, always run regardless of any of
 * the conditions above: looksLikeFabricatedCheckoutLink,
 * looksLikeFabricatedProductInList, and the claim guard
 * (requiredClaimCorrectionTool). A hallucinated checkout URL, an invented
 * PRODUCT in a numbered list, and a fabricated price/percentage/
 * availability claim are all serious enough on their own (a customer could
 * click a fake link, pick an option that doesn't exist, or act on a fake
 * price) that none can be gated behind "this looked like a price
 * objection" — this is why the closure is always built, never skipped for
 * a cheap early return. The invented-product check runs SECOND, right
 * after the checkout-link check and ahead of even the claim guard: found
 * live, a reply presenting a real ₹2799 item alongside a fully invented
 * "Linen Relaxed Fit Shirt — ₹2299" is worse than a wrong price alone — a
 * customer could select an option that doesn't exist — so it gets first
 * claim on the limited guardrail-retry budget, before anything else has a
 * chance to consume it on a less severe correction.
 */
function buildTurnGuardrail(
  customerMessage: string,
  facts: ConversationFacts,
): ((content: string) => string | undefined) | undefined {
  const priceObjectionRaised = looksLikePriceObjection(customerMessage);
  const pendingAlternativeTool =
    currentPendingQuestion(facts) === 'alternativeChoice' ? facts.pendingOptions?.tool : undefined;

  return (content: string) => {
    // Checked unconditionally, first — see this function's own doc.
    // Re-forces createCheckoutLink so the model's next attempt is grounded
    // in a real tool result instead of another guess.
    if (looksLikeFabricatedCheckoutLink(content, facts)) return 'createCheckoutLink';

    // Also unconditional, checked SECOND — see this function's own doc for
    // why an invented product gets first claim on the retry budget, ahead
    // of even the claim guard just below.
    const productListCorrection = requiredProductListCorrectionTool(content, facts);
    if (productListCorrection) return productListCorrection;

    // Also unconditional — a fabricated price, discount percentage, or
    // availability claim is at least as serious as a fabricated URL (see
    // the CLAIM GUARD section's own header comment), so it can't be gated
    // behind "this looked like a price objection" either. See
    // requiredClaimCorrectionTool's own doc for why the corrective tool
    // depends on WHICH claim was fabricated, rather than always re-forcing
    // getCartDetails.
    const claimCorrection = requiredClaimCorrectionTool(content, facts);
    if (claimCorrection) return claimCorrection;

    const selectionTool = requiredAlternativeSelectionTool(facts);
    if (selectionTool) return selectionTool;

    const removalTool = requiredCartItemRemovalTool(facts);
    if (removalTool) return removalTool;

    if (priceObjectionRaised) {
      const required = requiredPriceObjectionTool(facts);
      if (required) return required;
    }
    // Re-forces getCartDetails specifically — not findSimilarItems/etc —
    // since the missing piece here is the model actually USING the fabric
    // data it already fetched, not a new search. A fresh look at the same
    // result right before the reply is the same corrective lever used
    // everywhere else in this guardrail.
    if (priceObjectionRaised && looksLikeMissingPriceJustification(content, facts)) return 'getCartDetails';

    // Reached only once the fact-based branch above has nothing left to
    // force (priceObjectionAlreadyHandled(facts) already true) — the
    // content-level backstop for a reply that doesn't actually say so.
    // Gated on priceObjectionRaised specifically (not just "a guardrail
    // exists this turn" — selectionRequired alone can also open the
    // closure, e.g. a bare "1" applying a pick): found live, an
    // apply-the-selection-only turn tripped this as a false positive,
    // forcing a pointless findSimilarItems retry even though the
    // customer's message was never a price objection to begin with.
    if (priceObjectionRaised && looksLikePriceObjectionNonAnswer(content, facts)) {
      // Re-forces whichever alternative-finding tool most recently
      // populated facts.pendingOptions (live, not the possibly-stale
      // snapshot captured in pendingAlternativeTool above) so the model
      // sees that data again right before it has to answer.
      if (facts.pendingOptions?.tool) return facts.pendingOptions.tool;
      if (pendingAlternativeTool) return pendingAlternativeTool;
      // No alternative on the table yet. Found live: falling back to
      // checkDiscountEligibility here — even though facts already says
      // eligibility WAS checked — just re-runs the same already-known
      // check every retry (and trips checkForRedundantStep's own
      // violation log each time) without ever making progress, burning
      // the whole guardrail retry budget until sendAgentMessage's 6-round
      // cap gives up and returns the generic "having trouble" apology.
      // Only re-check eligibility if that's GENUINELY still missing;
      // otherwise the only useful next step for an ineligible cart is a
      // real alternative, so escalate to findSimilarItems instead of
      // repeating a check that already has its answer.
      if (!facts.discountEligibilityChecked) return 'checkDiscountEligibility';
      if (facts.discountEligible === false) return 'findSimilarItems';
      // Eligible and a code already exists but the reply didn't relay it
      // — no tool call fixes a phrasing gap; leave it to the ANSWER THE
      // OBJECTION prompt rule rather than force a pointless retry.
      return undefined;
    }
    return undefined;
  };
}

/** The customer's whole reply as a number, if that's all it is (leading
 * digits up to a word boundary) — e.g. "2" -> 2, "2 please" -> 2.
 * Deliberately NOT capped at the in-range set: an out-of-range reply like
 * "6" on a 3-item list still needs to be caught (see validatePendingChoice),
 * not silently ignored. */
function fullNumeral(text: string): number | null {
  const m = text.trim().match(/^(\d+)\b/);
  return m ? Number(m[1]) : null;
}

// Bare acknowledgements never answer "which one" when MULTIPLE options are
// pending — seen in Vastra when the model resolves a step and asks the
// next open question in the same breath, so the customer's next message
// can be a stray "yes"/"ok" answering something else entirely. Capturing
// that verbatim would corrupt the summary for the rest of the
// conversation. Deliberately does NOT apply when exactly one option is
// pending — see looksLikeSingleOptionAcceptance below, added after a live
// bug report: a customer offered exactly one alternative and replying
// "yes"/"yeah" never registered a selection at all, because this set
// swallowed it before it ever reached the numeral/name matching below.
// With only one option on the table, "which one" has exactly one possible
// answer — there's no ambiguity left for a bare acknowledgement to be
// wrong about.
const BARE_ACKNOWLEDGEMENTS = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'y', 'no', 'nope', 'n']);

/** Real customers accepting a single presented alternative rarely say "1"
 * — they say "yes", "sounds good", "that one", or name the item itself
 * ("the clay one"). Broad on purpose, same class of heuristic as
 * PRICE_OBJECTION_PATTERN elsewhere in this file — not exhaustive, just
 * covers the common phrasings a WhatsApp reply actually takes.
 *
 * Deliberately does NOT include "ok"/"okay"/"sure"/"perfect"/"great" —
 * see WEAK_AFFIRMATIVE_PATTERN below. This action replaces the customer's
 * cart; only phrases that can't reasonably mean anything OTHER than "yes,
 * that one" auto-trigger it. */
const STRONG_AFFIRMATIVE_PATTERN =
  /\b(yes|yeah|yep|yup|sounds good|works for me|that works|i'?ll take (?:it|that|this)|go (?:ahead|for it)|let'?s do (?:it|that)|that one|this one)\b/i;

/**
 * Acknowledgements that COULD mean acceptance but just as easily mean
 * "understood, keep going" — found live: "ok" replying to a price
 * JUSTIFICATION (no alternative offered yet) got read as accepting an
 * alternative that had never even been mentioned; then, once an
 * alternative genuinely HAD been presented, "ok" alone STILL swapped the
 * cart and sent checkout immediately, with the customer never having
 * actually said yes to that specific item — "ok" means "understood" as
 * easily as "yes, swap it." These never auto-select anything (see
 * looksLikeSingleOptionNeedsConfirmation) — they trigger a short
 * confirming question instead, the same "resolve it in code, before the
 * LLM ever sees the ambiguity" approach already used for the 2+-option
 * case (looksLikeAmbiguousAcceptance).
 */
const WEAK_AFFIRMATIVE_PATTERN = /\b(ok(?:ay)?|sure|perfect|great|please do|do it)\b/i;

/** A negative anywhere in the reply overrides an apparent match on the
 * item's own name — "no, not the clay one" mentions "clay" but is a
 * rejection, not a selection. Checked first, short-circuiting both other
 * checks below. */
const NEGATIVE_PATTERN = /\b(no|nope|nah|not|don'?t|never ?mind)\b/i;

/** True when the reply names the pending item itself — "the clay one" for
 * "Clay Hand Block-Print Midi Dress" — rather than a generic affirmative.
 * Matches on any word longer than 3 characters from the item's own name,
 * so this is always checked against REAL data already returned by an
 * alternative-finding tool, never a guess. */
function mentionsOptionByName(text: string, item: { name: string }): boolean {
  const lower = text.toLowerCase();
  const words = item.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  return words.some((w) => lower.includes(w));
}

/**
 * Lowercases AND folds every Unicode hyphen/dash lookalike (non-breaking
 * hyphen, figure dash, en/em dash, minus sign) to a plain ASCII "-" —
 * found live: a reply correctly named "Sage Linen A-Line Kurta" but with a
 * non-breaking hyphen (U+2011) in place of the catalog's plain one, which
 * silently failed a straight `.includes()` substring check against the
 * real catalog name. Models routinely "prettify" a hyphen this way when
 * generating text; a substring match against a catalog name has to survive
 * that or it under-counts which items were genuinely shown — see
 * imagesToAttach (a per-item image without this could simply never
 * appear) and markPendingOptionsPresented (same risk, one level up).
 */
function normalizeForMatch(s: string): string {
  // ‐-― covers hyphen, non-breaking hyphen, figure dash, en
  // dash, em dash, and horizontal bar; − is the Unicode minus sign.
  return s.toLowerCase().replace(/[‐-―−]/g, '-');
}

/**
 * True when EVERY distinctive word (len > 3, hyphens kept as part of a
 * word) of `itemName` appears somewhere in `text` — not a single contiguous
 * substring match. Found live, back to back: a reply named an item with a
 * different Unicode hyphen than the catalog's own (normalizeForMatch's own
 * bug), and separately a reply inserted an extra word mid-name ("Undyed
 * NATURAL Cotton Straight Kurta" for the catalog's "Undyed Cotton Straight
 * Kurta") — both are genuine, complete descriptions of the real item, but
 * neither survives a strict `.includes(fullName)` check. Requiring every
 * distinctive WORD (not the whole phrase, and not just one word the way
 * mentionsOptionByName's lighter `.some()` bar works for a short customer
 * reply) keeps this resistant to word-order/insertion noise while still
 * demanding real evidence the item was actually, fully described — not
 * just alluded to by one word in passing.
 */
function repliesGenuinelyDescribe(text: string, itemName: string): boolean {
  const words = normalizeForMatch(itemName)
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 3);
  if (words.length === 0) return false;
  const lowerText = normalizeForMatch(text);
  return words.every((w) => lowerText.includes(w));
}

/**
 * Resolves which line of a MULTI-ITEM cart the customer wants dropped from
 * free text like "I only really want the co-ord set, not the top" — same
 * word-overlap matching mentionsOptionByName already uses, just applied to
 * the cart's OWN items instead of a freshly-presented alternatives list,
 * and split into clauses so negation is judged per-clause, not globally:
 * "not" appearing anywhere in the message would otherwise flip a mention
 * that was never actually negated (e.g. misreading "only the co-ord set"
 * as negated because a LATER clause happens to contain "not").
 *
 * Only ever returns an itemId when the text unambiguously points at
 * exactly one line to remove:
 *  - a mention inside a clause containing a negation word (NEGATIVE_PATTERN)
 *    -> remove that item directly ("not the top").
 *  - exactly one item mentioned anywhere, cart has exactly two items, no
 *    negation at all -> the UNMENTIONED item is what's being dropped
 *    ("I'll just take the co-ord set").
 * Anything murkier (nothing mentioned, both items mentioned with no
 * negation, 3+ item carts with only one clear mention) returns undefined
 * and is left to the model — same fallback posture as every other
 * heuristic in this file.
 */
function resolvePartialCartRemoval(items: CartLineItem[], message: string): string | undefined {
  if (items.length < 2) return undefined;
  const resolved = items
    .map((line) => ({ itemId: line.itemId, product: getCatalogItem(line.itemId) }))
    .filter((x): x is { itemId: string; product: NonNullable<ReturnType<typeof getCatalogItem>> } => Boolean(x.product));
  if (resolved.length < 2) return undefined;

  const clauses = message.toLowerCase().split(/[,.;]|\bbut\b/);
  let keep: string | undefined;
  let remove: string | undefined;
  for (const clause of clauses) {
    const negated = NEGATIVE_PATTERN.test(clause);
    for (const { itemId, product } of resolved) {
      const mentioned = mentionsOptionByName(clause, product) || clause.includes(product.category.toLowerCase());
      if (!mentioned) continue;
      if (negated) remove = remove ?? itemId;
      else keep = keep ?? itemId;
    }
  }
  if (remove) return remove;
  if (keep && resolved.length === 2) return resolved.find((r) => r.itemId !== keep)?.itemId;
  return undefined;
}

/**
 * True when the reply unambiguously accepts the ONE alternative currently
 * on offer — a bare affirmative, or a mention of the item by name — found
 * missing live: "yes"/"yeah" replying to a single-item list never
 * registered a selection, so selectAlternative never got forced and
 * checkout went through on the ORIGINAL item at its original price. Only
 * ever called when exactly one option is pending (see captureNextReply) —
 * with two or more options, the same "yes" is genuinely ambiguous and
 * should NOT auto-select anything.
 */
function looksLikeSingleOptionAcceptance(text: string, item: { name: string }): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NEGATIVE_PATTERN.test(trimmed)) return false;
  if (STRONG_AFFIRMATIVE_PATTERN.test(trimmed)) return true;
  return mentionsOptionByName(trimmed, item);
}

/**
 * True when a single pending option's acceptance is genuinely ambiguous —
 * a WEAK affirmative ("ok", "sure", "perfect") that isn't a strong
 * affirmative and doesn't name the item specifically. Never auto-selects;
 * see validatePendingChoice, which turns this into a direct confirming
 * question instead of guessing.
 */
function looksLikeSingleOptionNeedsConfirmation(text: string, item: { name: string }): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NEGATIVE_PATTERN.test(trimmed)) return false;
  if (mentionsOptionByName(trimmed, item)) return false;
  if (STRONG_AFFIRMATIVE_PATTERN.test(trimmed)) return false;
  return WEAK_AFFIRMATIVE_PATTERN.test(trimmed);
}

/**
 * True when the reply is a bare/generic affirmative to TWO OR MORE pending
 * options — accepting *something*, without saying which. Found live: "yes
 * i like it" to a 2-item list didn't match any numeral or item name, so
 * nothing captured a selection — but nothing stopped the conversation from
 * proceeding to checkout on the ORIGINAL item either, since the code only
 * ever blocks on a selection it knows was ambiguous, not one that was
 * silently never resolved. Excludes a reply that names exactly one of the
 * options (that's an unambiguous pick, handled in captureNextReply, not
 * this) and excludes anything containing a negative.
 */
function looksLikeAmbiguousAcceptance(text: string, options: { name: string }[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (NEGATIVE_PATTERN.test(trimmed)) return false;
  if (options.some((o) => mentionsOptionByName(trimmed, o))) return false;
  return STRONG_AFFIRMATIVE_PATTERN.test(trimmed) || WEAK_AFFIRMATIVE_PATTERN.test(trimmed);
}

/**
 * The code-level guard the tools themselves can't provide: nothing stops
 * the model from picking a plausible-looking option when a customer's
 * numbered reply is out of range ("6" on a 3-item alternatives list) — the
 * model just picks something instead of asking again. This runs BEFORE the
 * message ever reaches the model: if the customer's whole reply is a
 * number and it's outside the range of whatever's actually pending, the
 * turn never becomes an LLM call at all — a direct rejection is shown and
 * the real question stays open. A prose reply, an in-range number, or
 * nothing pending all fall through untouched.
 *
 * Also catches the ambiguous-acceptance case (looksLikeAmbiguousAcceptance)
 * the same way, for the same reason: found live, "yes i like it" to a
 * 2-item list reached the model anyway, which — on a weak enough
 * provider/model combination — just ignored the ambiguity and checked out
 * the ORIGINAL item instead of asking which one. Resolving this in code
 * before the LLM ever sees the message means it can't depend on any
 * particular model's judgment at all.
 */
function validatePendingChoice(facts: ConversationFacts, incomingMessage: string): string | undefined {
  const pending = currentPendingQuestion(facts);
  if (!pending) return undefined;
  const options = facts.pendingOptions?.items ?? [];
  const trimmed = incomingMessage.trim();

  const n = fullNumeral(trimmed);
  if (n !== null) {
    const count = options.length;
    if (count === 0 || (n >= 1 && n <= count)) return undefined;
    return count === 1
      ? "I only have option 1 to offer there — did you mean that one?"
      : `I only have options 1–${count} to offer there — which one did you mean?`;
  }

  if (options.length > 1 && looksLikeAmbiguousAcceptance(trimmed, options)) {
    const list = options.map((o, i) => `${i + 1}) ${o.name}`).join(', ');
    return `Just to confirm which one — ${list}?`;
  }

  // Exactly one option, but a WEAK affirmative ("ok", "sure", "perfect")
  // — not clearly "yes, swap it" rather than just "understood." Found
  // live: this is what let the cart get silently swapped and checked out
  // on a customer who'd only acknowledged a PRICE JUSTIFICATION, no
  // alternative even offered yet — and separately, on a genuinely offered
  // single alternative, still swapped on an "ok" that just as plausibly
  // meant "got it, thanks for explaining." A cart-replacing action gets a
  // real confirmation, not a guess.
  if (options.length === 1 && looksLikeSingleOptionNeedsConfirmation(trimmed, options[0])) {
    const only = options[0];
    return `Just to confirm — you'd like me to switch you to the ${only.name} (₹${only.price})? Reply yes to confirm.`;
  }

  return undefined;
}

/**
 * Captures the customer's next message as the answer to whichever question
 * currentPendingQuestion says is open. Only ever called with a message
 * validatePendingChoice has already approved (in range, or not a bare
 * numeral at all) — this function itself doesn't re-check bounds. A bare
 * numeral resolves against `pendingOptions.items` (generated data, not
 * fixed prompt text, so resolution is always against what was actually
 * offered this conversation). A prose reply ("the sage one") is left
 * unresolved — the model can still reason from it via createCheckoutLink's
 * own itemId-adjacent context, but this function doesn't guess.
 */
function captureNextReply(facts: ConversationFacts, incomingMessage: string): void {
  const pending = currentPendingQuestion(facts);
  if (!pending) return;
  const trimmed = incomingMessage.trim();
  const options = facts.pendingOptions?.items;
  if (!options || options.length === 0) return;

  const n = fullNumeral(trimmed);
  let matched = n ? options[n - 1] : undefined;

  // Named a specific option — "the clay one" — unambiguous regardless of
  // how many options are pending, as long as it names exactly ONE of
  // them. Checked before the single-option branch below so a 2+ item list
  // where the customer names one specifically still resolves (a generic
  // affirmative genuinely can't, and stays unresolved here — see
  // looksLikeAmbiguousAcceptance in validatePendingChoice, which catches
  // that case before it ever reaches this function).
  if (!matched && !NEGATIVE_PATTERN.test(trimmed)) {
    const namedMatches = options.filter((o) => mentionsOptionByName(trimmed, o));
    if (namedMatches.length === 1) matched = namedMatches[0];
  }

  // Exactly one option pending -> no ambiguity for an affirmative to be
  // wrong about (see looksLikeSingleOptionAcceptance's own comment). Two
  // or more options: an affirmative genuinely doesn't say which one, so
  // this branch never runs and the BARE_ACKNOWLEDGEMENTS check below still
  // applies as before.
  if (!matched && options.length === 1 && looksLikeSingleOptionAcceptance(trimmed, options[0])) {
    matched = options[0];
  }

  if (!matched && BARE_ACKNOWLEDGEMENTS.has(trimmed.toLowerCase())) return;

  if (matched) {
    facts.selectedAlternativeItemId = matched.itemId;
    facts.selectedAlternativeName = matched.name;
    facts.alternativeSelectionApplied = false;
    facts.pendingOptions = undefined;
  }
}

/**
 * Requirement: fail loudly, in the console, the moment the agent redoes a
 * step `facts` already says is finished — instead of that only surfacing
 * several rounds later in live testing. Deterministic and tool-call-based,
 * not text-matching the agent's reply. A console.error, never a thrown
 * exception — this is a development diagnostic, not something that should
 * ever interrupt the demo (tools.ts's own guards are what actually stop a
 * wrong action; this is what makes an ATTEMPT visible).
 */
function checkForRedundantStep(facts: ConversationFacts, name: string): void {
  const step = FLOW.find((s) => s.tools.includes(name));
  if (step && step.applies(facts) && step.done(facts)) {
    console.error(
      `[useCartRecoveryAgent] STATE MACHINE VIOLATION: ${name} was called again after "${step.label}" — the agent is asking for/redoing something it already has the answer to.`,
      { facts: { ...facts } },
    );
  }
}

const ALTERNATIVE_TOOLS = new Set([
  'findSimilarItems',
  'findAlternativesBySize',
  'findAlternativesByBudget',
  'findAlternativesByColour',
  'getActiveSales',
  // Trigger 2 (recommendations) — deliberately returns the same `items`
  // shape as the tools above, so it plugs into pendingOptions/
  // presented-before-selectable/selectAlternative for free, no new
  // state-machine code required. See tools.ts's own comment on
  // getRecommendationsFromHistoryTool.
  'getRecommendationsFromHistory',
]);

/**
 * Tool calls that mean the turn has moved on to a closing/administrative
 * action — a discount code, a checkout/reorder link, a final outcome —
 * rather than presenting a product. Checked in sendMessage's onToolCall
 * callback: if any of these fire during a turn, no product image is
 * attached to that turn's reply even if an ALTERNATIVE_TOOLS call also
 * happened to run earlier in the same turn. Matches the build spec's
 * WHERE NOT TO USE list verbatim — discount code messages, confirmations,
 * checkout links are never image messages.
 */
const IMAGE_SUPPRESSING_TOOLS = new Set(['createCheckoutLink', 'generateDiscountCode', 'markCartOutcome']);

/** Words too generic to prove a reply actually justified THIS item's price
 * — every kurta/dress/saree in the catalog would trivially "pass" a check
 * that accepted these, which defeats the point of grounding the check in
 * real per-item data at all. */
const GENERIC_JUSTIFICATION_TERMS = new Set([
  'dress', 'dresses', 'kurta', 'kurtas', 'shirt', 'shirts', 'trousers', 'saree', 'sarees',
  'print', 'prints', 'solid', 'plain', 'fitted', 'fitting', 'fabric', 'material',
]);

/** Distinctive words/phrases from an item's own name + fabric text — see
 * ConversationFacts.itemJustificationTerms. Hyphenated compounds (e.g.
 * "hand-embroidered") are kept as one token since they're more distinctive
 * than their parts split apart. */
function extractJustificationTerms(name: string, fabric: string): string[] {
  const combined = `${name} ${fabric}`.toLowerCase();
  const words = combined.match(/[a-z][a-z-]{4,}/g) ?? [];
  return Array.from(new Set(words.filter((w) => !GENERIC_JUSTIFICATION_TERMS.has(w))));
}

function updateFacts(facts: ConversationFacts, name: string, _args: Record<string, unknown>, result: unknown): void {
  checkForRedundantStep(facts, name);
  const r = result as Record<string, unknown> | undefined;

  if (ALTERNATIVE_TOOLS.has(name)) {
    const items = (r?.items as { itemId: string; name: string; price: number }[] | undefined) ?? [];
    // maxBudget echoes the customer's OWN stated number back — see
    // findAlternativesByBudgetTool — recorded regardless of whether any
    // items matched, so a reply can still say "nothing under ₹2000" using
    // the customer's own real figure without tripping the claim guard.
    recordPrice(facts, (r?.maxBudget as number | undefined) ?? undefined);
    if (r?.success !== false && items.length > 0) {
      for (const it of items) recordPrice(facts, it.price);
      facts.pendingOptions = {
        tool: name,
        items: items.map((it) => ({ itemId: it.itemId, name: it.name, price: it.price })),
        // Not yet shown to the customer — see markPendingOptionsPresented,
        // called once the turn's actual final reply text is known.
        presented: false,
      };
      facts.selectedAlternativeItemId = undefined;
      facts.selectedAlternativeName = undefined;
      facts.alternativeSelectionApplied = undefined;
    }
    return;
  }

  switch (name) {
    case 'getCartDetails':
      if (r?.success) {
        facts.cartDetailsChecked = true;
        const items = (r.items as { name?: string; fabric?: string; price?: number; sizeInStock?: boolean }[] | undefined) ?? [];
        facts.itemJustificationTerms = items.flatMap((it) => extractJustificationTerms(it.name ?? '', it.fabric ?? ''));
        for (const it of items) {
          recordPrice(facts, it.price);
          if (it.sizeInStock === true) facts.cartAnyItemInStock = true;
          if (it.sizeInStock === false) facts.cartAnyItemOutOfStock = true;
        }
        recordPrice(facts, r.cartValue as number | undefined);
      }
      break;
    case 'selectAlternative':
      if (r?.success) {
        facts.alternativeSelectionApplied = true;
        facts.selectedAlternativeItemId = r.itemId as string | undefined;
        facts.selectedAlternativeName = r.name as string | undefined;
        recordPrice(facts, r.price as number | undefined);
      }
      break;
    case 'removeCartItem':
      if (r?.success) {
        facts.cartItemRemovalApplied = true;
        facts.pendingCartItemRemoval = r.removedItemId as string | undefined;
        facts.pendingCartItemRemovalName = r.removedName as string | undefined;
        recordPrice(facts, r.newCartValue as number | undefined);
      }
      break;
    case 'checkDiscountEligibility':
      if (r?.success) {
        facts.discountEligibilityChecked = true;
        facts.discountEligible = r.eligible as boolean | undefined;
        facts.discountMaxPercent = r.maxDiscountPercent as number | undefined;
        recordPercent(facts, r.maxDiscountPercent as number | undefined);
        recordPrice(facts, r.cartValue as number | undefined);
      }
      break;
    case 'generateDiscountCode':
      if (r?.success) {
        facts.discountOffered = true;
        facts.discountPercent = r.discountPercent as number | undefined;
        facts.discountCode = r.discountCode as string | undefined;
        recordPercent(facts, r.discountPercent as number | undefined);
      } else {
        // A failed generateDiscountCode call means eligibility was just
        // checked INTERNALLY (pricingPolicy.ts's own checkDiscountEligibility)
        // and found false — even when the model skipped calling the
        // separate checkDiscountEligibility tool first and went straight
        // here. Without this, facts never learns the item is ineligible,
        // so a reply that correctly explains that can never satisfy
        // looksLikePriceObjectionNonAnswer's hasDiscountDecision check
        // (which specifically requires facts.discountEligible === false) —
        // found live, CART-008: this alone was enough to exhaust the
        // guardrail retry budget into the generic "having trouble" apology
        // on a turn whose actual reply content was fine.
        facts.discountEligibilityChecked = true;
        facts.discountEligible = false;
      }
      break;
    case 'createCheckoutLink':
      if (r?.success) {
        facts.checkoutLinkCreated = true;
        facts.checkoutLink = r.checkoutLink as string | undefined;
        recordPrice(facts, r.finalAmount as number | undefined);
      }
      break;
    case 'markCartOutcome':
      if (r?.success) facts.outcomeSet = r.outcome as CartOutcome | undefined;
      break;
    case 'getBrowseAbandonment': {
      facts.browseAbandonmentChecked = true;
      const items = (r?.items as { price?: number }[] | undefined) ?? [];
      for (const it of items) recordPrice(facts, it.price);
      break;
    }
  }
}

/**
 * Marks facts.pendingOptions as actually shown to the customer — called
 * once per turn, right after sendAgentMessage resolves with the REAL final
 * reply text (never from inside the tool-call loop, where only individual
 * tool results are known, not what the reply ultimately said). A tool call
 * succeeding is not the same claim as the customer having been told
 * anything; this is the one place that turns "the data exists" into "the
 * customer has seen it," which is what currentPendingQuestion/
 * captureNextReply now require before treating any reply as an answer to
 * "which one." Checked via a substring match on the item's own name — the
 * same heuristic already used elsewhere in this file (e.g.
 * looksLikePriceObjectionNonAnswer) — so this only ever confirms
 * presentation against REAL data, never a guess.
 */
function markPendingOptionsPresented(facts: ConversationFacts, replyText: string): void {
  if (!facts.pendingOptions || facts.pendingOptions.presented) return;
  const shown = facts.pendingOptions.items.some((it) => repliesGenuinelyDescribe(replyText, it.name));
  if (shown) {
    facts.pendingOptions.presented = true;
    facts.anyAlternativePresented = true;
  }
}

/**
 * Derives the summary text entirely from `facts` — never the other way
 * round, and walked in the same order FLOW/currentPendingQuestion would
 * check, so the "already established" list this hands the model always
 * matches what the code-level guards actually enforce.
 */
function factsToSummary(f: ConversationFacts): string {
  const parts: string[] = [];
  if (f.cartDetailsChecked) parts.push('cart details already fetched this conversation — no need to re-fetch unless something may have changed');
  if (f.discountEligibilityChecked) {
    parts.push(
      f.discountEligible
        ? `discount eligibility already checked: eligible up to ${f.discountMaxPercent}% — do not check again unless meaningful time has passed`
        : 'discount eligibility already checked: NOT eligible right now — do not re-check or promise a discount',
    );
  }
  if (f.discountOffered) {
    parts.push(`a discount code was already generated: ${f.discountCode} (${f.discountPercent}%) — do NOT generate another, only one per cart`);
  }
  if (f.pendingOptions?.items.length) {
    const list = f.pendingOptions.items.map((it, i) => `${i + 1}. ${it.name} (₹${it.price})`).join('; ');
    parts.push(
      f.pendingOptions.presented
        ? `alternatives already presented to the customer via ${f.pendingOptions.tool}: ${list} — do NOT re-list these or call that tool again; wait for the customer to pick one (they may answer with just a number)`
        : `${f.pendingOptions.tool} already found these alternatives but they have NOT been shown to the customer yet: ${list} — your reply this turn MUST present them (as a numbered list, using these exact names/prices) before anything else; do not treat an acknowledgement like "ok" as accepting one, since none has actually been offered yet`,
    );
  }
  if (f.selectedAlternativeItemId && !f.alternativeSelectionApplied) {
    parts.push(
      `the customer just picked an alternative (${f.selectedAlternativeName}, itemId ${f.selectedAlternativeItemId}) — you MUST call selectAlternative with that itemId before replying; the cart still points at the OLD item until you do, so any price or checkout link right now would be wrong`,
    );
  } else if (f.selectedAlternativeName) {
    parts.push(`customer selected: ${f.selectedAlternativeName} — the cart has already been swapped to this item, do not ask them to choose again`);
  }
  if (f.pendingCartItemRemoval && !f.cartItemRemovalApplied) {
    parts.push(
      `the customer just said they don't want "${f.pendingCartItemRemovalName ?? f.pendingCartItemRemoval}" from this multi-item cart — you MUST call removeCartItem with itemId ${f.pendingCartItemRemoval} before replying; the cart still has the full original items until you do, so any price or checkout link right now would be wrong`,
    );
  } else if (f.cartItemRemovalApplied) {
    parts.push(`already removed from this cart: ${f.pendingCartItemRemovalName ?? f.pendingCartItemRemoval} — the cart now only reflects what the customer actually wants, do not re-ask or re-list what was dropped`);
  }
  if (f.checkoutLinkCreated) parts.push(`a checkout link was already created (${f.checkoutLink}) — do NOT create another`);
  if (f.browseAbandonmentChecked) parts.push('browse-abandonment items already fetched this conversation — no need to re-check');
  if (f.outcomeSet) {
    parts.push(`final outcome already recorded as "${f.outcomeSet}" — do NOT call markCartOutcome again for this cart`);
    if (f.outcomeSet === 'opted_out') {
      parts.push(
        'this customer opted out — if they are writing to you now anyway, that is THEM re-opening the conversation; answer what they actually ask normally, but do not bring back the original pitch or a promotion unprompted',
      );
    }
  }
  return parts.join('. ');
}

export interface CampaignStats {
  cartsTargeted: number;
  messagesSent: number;
  repliesReceived: number;
  /** Carts with a checkout link created but NOT yet confirmed paid — see
   * CartOutcome's own doc. Counts both the normal 'checkout_sent' path and
   * an opted-out cart's customerInitiatedRecovery before it's marked paid.
   * The funnel's 4th stage, between "replied" and "paid" (recoveredCount) —
   * a link existing is intent, not revenue. */
  linkSentCount: number;
  /** Sum of amountPaidForCart across every cart in linkSentCount above —
   * value that's been quoted to a customer but not yet confirmed paid.
   * Deliberately its own figure, never folded into revenueRecovered. */
  pendingCheckoutValue: number;
  recoveredCount: number;
  lostCount: number;
  optedOutCount: number;
  recoveryRate: number; // 0-100, one decimal — campaign-attributed (outbound-driven) only, CONFIRMED PAID only
  revenueRecovered: number; // campaign-attributed (outbound-driven), CONFIRMED PAID only — see customerInitiatedRecoveredRevenue
  /** Sum of resolveCart(c).cartValue across every cart regardless of
   * outcome — the campaign's total addressable value. Used only as the
   * denominator for the "share of total recovered" progress bar; not a
   * KPI in its own right. */
  totalCartValue: number;
  /** Sum of CURRENT cart value across carts still 'active' only — a lost
   * or opted-out cart is resolved, not "still" at risk, even though it
   * never turned into recovered revenue either, so it's excluded here
   * (previously this was computed as totalCartValue - revenueRecovered,
   * which wrongly folded every lost/opted-out cart's value into "at
   * risk" too). */
  revenueAtRisk: number;
  avgDiscountPercent: number | null;
  /** Carts that opted out but later bought anyway because THEY messaged
   * back in — see tools.ts's createCheckoutLinkTool and
   * AbandonedCart.customerInitiatedRecovery. Deliberately excluded from
   * recoveredCount/revenueRecovered/recoveryRate above: those three exist
   * to measure the CAMPAIGN's effectiveness, and no outbound message
   * produced this revenue, so counting it there would credit the outreach
   * for a sale it didn't cause. */
  customerInitiatedRecoveredCount: number;
  customerInitiatedRecoveredRevenue: number;
}

/** Every campaign type, in the order the dashboard's selector shows them —
 * used both to build statsByType below and by the dashboard's own
 * CampaignTypeSelector. */
export const CAMPAIGN_TYPES: CampaignType[] = ['cart_recovery', 'recommendation', 'browse_abandonment'];

/**
 * Pulled out of the `stats` useMemo below so the exact same KPI math can
 * run once over the full cart list (the "All campaigns" combined view) and
 * once per campaignType (the per-trigger dashboard view) — one function,
 * so the two views can never silently drift into computing a KPI two
 * different ways. Takes a pre-filtered `carts` slice; every figure it
 * returns is scoped to exactly the carts it was given.
 */
function computeCampaignStats(carts: AbandonedCart[], threads: Record<string, ThreadState>): CampaignStats {
  const cartsTargeted = carts.length;
  const messagesSent = cartsTargeted;
  const repliesReceived = carts.filter((c) => threads[c.cartId]?.messages.some((m) => m.role === 'user')).length;
  const recovered = carts.filter((c) => c.outcome === 'recovered');
  const lostCount = carts.filter((c) => c.outcome === 'lost').length;
  const optedOutCount = carts.filter((c) => c.outcome === 'opted_out').length;
  const recoveryRate = cartsTargeted === 0 ? 0 : Math.round((recovered.length / cartsTargeted) * 1000) / 10;
  const revenueRecovered = recovered.reduce((sum, c) => sum + amountPaidForCart(c), 0);
  const totalCartValue = carts.reduce((sum, c) => sum + resolveCart(c).cartValue, 0);
  const revenueAtRisk = carts.filter((c) => c.outcome === 'active').reduce((sum, c) => sum + resolveCart(c).cartValue, 0);
  const linkSent = carts.filter((c) => Boolean(c.checkoutLink) || Boolean(c.customerInitiatedRecovery));
  const pendingCheckout = carts.filter(
    (c) => c.outcome === 'checkout_sent' || (c.customerInitiatedRecovery && !c.customerInitiatedRecovery.paid),
  );
  const pendingCheckoutValue = pendingCheckout.reduce((sum, c) => sum + amountPaidForCart(c), 0);
  const discounted = carts.filter((c) => c.discountOffered && c.discountPercent != null);
  const avgDiscountPercent =
    discounted.length === 0
      ? null
      : Math.round((discounted.reduce((sum, c) => sum + (c.discountPercent ?? 0), 0) / discounted.length) * 10) / 10;
  const customerInitiated = carts.filter((c) => c.customerInitiatedRecovery?.paid);
  const customerInitiatedRecoveredCount = customerInitiated.length;
  const customerInitiatedRecoveredRevenue = customerInitiated.reduce((sum, c) => sum + amountPaidForCart(c), 0);
  return {
    cartsTargeted,
    messagesSent,
    repliesReceived,
    linkSentCount: linkSent.length,
    pendingCheckoutValue,
    recoveredCount: recovered.length,
    lostCount,
    optedOutCount,
    recoveryRate,
    revenueRecovered,
    totalCartValue,
    revenueAtRisk,
    avgDiscountPercent,
    customerInitiatedRecoveredCount,
    customerInitiatedRecoveredRevenue,
  };
}

function isQuotaError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.includes('429') || lower.includes('quota') || lower.includes('rate limit');
}

export function useCartRecoveryAgent() {
  const brand = koraBrand;
  const apiKeyMissing = !hasApiKey();

  const [carts, setCarts] = useState<AbandonedCart[]>(() => brand.catalog);
  const cartsRef = useRef<AbandonedCart[]>(carts);
  useEffect(() => {
    cartsRef.current = carts;
  }, [carts]);

  const [threads, setThreads] = useState<Record<string, ThreadState>>(() =>
    buildInitialThreads(brand.catalog, brand.productBaseUrl),
  );

  const sessionsRef = useRef<Record<string, ChatSession>>(buildInitialSessions(brand, brand.catalog));

  /**
   * Reentrancy guard for sendMessage. An earlier version read
   * `threads[cartId].isTyping` (via a ref kept in sync with that state by
   * a `useEffect`) to decide whether a cart was already mid-send — found
   * live via runScenario, whose for-loop awaits sendMessage calls
   * back-to-back with no gap between one call resolving and the next
   * starting: a passive effect isn't guaranteed to have flushed in the
   * instant between one async call returning and the very next line of
   * code running, so that guard could (and did) read a stale
   * `isTyping: true` left over from the turn that just finished, and
   * silently drop the next customer turn — no user bubble, no error,
   * nothing. This set is mutated synchronously at the start/end of
   * sendMessage itself, with no dependency on React's render/effect cycle
   * at all, so it can never be stale.
   */
  const sendingCartIdsRef = useRef<Set<string>>(new Set());

  /** Per-cart conversational memory (see the state-machine section above) —
   * a live ref, not React state: read/written mid-turn, inside an async
   * tool-call loop, where a re-render isn't the point. */
  const factsRef = useRef<Record<string, ConversationFacts>>(
    Object.fromEntries(brand.catalog.map((c) => [c.cartId, {} as ConversationFacts])),
  );

  const [activeCartId, setActiveCartId] = useState<string>(brand.catalog[0].cartId);

  /**
   * Builds the tool-executor map for one sendAgentMessage call. `working`
   * is a local snapshot mutated synchronously as tools run — necessary
   * because a single model turn can call more than one tool back-to-back
   * (e.g. generateDiscountCode then createCheckoutLink) before React ever
   * re-renders, so reading through cartsRef.current between those two
   * calls would see stale data (no discountCode yet). `working` guarantees
   * each tool call in the same turn sees every prior tool call's effect.
   * The actual React state update still goes through a functional setCarts
   * call keyed to the single cart being touched, so it can't clobber a
   * concurrent update to some *other* cart's thread.
   */
  const buildExecutors = useCallback((cartId: string, facts: ConversationFacts): ToolExecutorMap => {
    let working = cartsRef.current;
    // Resolved once — customerId never changes for a cart, even as
    // `working` itself gets reassigned below as tools mutate other fields.
    const customerId = working.find((c) => c.cartId === cartId)?.customerId ?? '';

    function applyCartUpdate(updated: AbandonedCart | null) {
      if (!updated) return;
      working = working.map((c) => (c.cartId === updated.cartId ? updated : c));
      setCarts((prev) => prev.map((c) => (c.cartId === updated.cartId ? updated : c)));
    }

    // Every findAlternatives*/findSimilarItems call in this app means "an
    // alternative to THIS cart's own item" — there is no other kind of
    // "source item" a price/fit/colour objection could be about. Found
    // live on a weak fallback model: the customer's cart's real itemId is
    // sitting right there in the tool result it just read, but a forced
    // tool call (tool_choice pins the function, never the arguments) can
    // still invent a plausible-looking itemId instead of using it, get
    // "Item not found in catalog," and burn the whole guardrail retry
    // budget on repeated failures — which then lets a genuinely fabricated
    // reply straight through on the final, no-longer-checked round. Falls
    // back to the cart's own item whenever the model's itemId doesn't
    // resolve to a real catalog entry, so a hallucinated argument can never
    // sink the whole objection-handling flow.
    function resolveSourceItemId(forCartId: string, argItemId: unknown): string {
      const asString = String(argItemId ?? '').trim();
      if (asString && getCatalogItem(asString)) return asString;
      const cart = working.find((c) => c.cartId === forCartId);
      return cart?.items[0]?.itemId ?? asString;
    }

    return {
      getCartDetails: (args) => getCartDetailsTool(working, String(args.cartId ?? cartId)).output,
      checkDiscountEligibility: (args) =>
        checkDiscountEligibilityTool(working, String(args.cartId ?? cartId)).output,
      generateDiscountCode: (args) => {
        const res = generateDiscountCodeTool(working, String(args.cartId ?? cartId));
        applyCartUpdate(res.cart);
        return res.output;
      },
      findSimilarItems: (args) =>
        findSimilarItemsTool(resolveSourceItemId(String(args.cartId ?? cartId), args.itemId), Number(args.maxPrice ?? 0)),
      findAlternativesBySize: (args) =>
        findAlternativesBySizeTool(resolveSourceItemId(String(args.cartId ?? cartId), args.itemId), String(args.size ?? '')),
      findAlternativesByBudget: (args) =>
        findAlternativesByBudgetTool(
          resolveSourceItemId(String(args.cartId ?? cartId), args.itemId),
          Number(args.maxBudget ?? 0),
        ),
      findAlternativesByColour: (args) =>
        findAlternativesByColourTool(
          resolveSourceItemId(String(args.cartId ?? cartId), args.itemId),
          String(args.excludeColour ?? ''),
        ),
      getActiveSales: (args) => getActiveSalesTool(args.category ? String(args.category) : undefined),
      selectAlternative: (args) => {
        // Hard backstop: even if currentPendingQuestion/captureNextReply
        // somehow captured a selection without the alternative genuinely
        // having been shown (a future regression), this tool itself must
        // still be incapable of swapping the cart to something the
        // customer never actually saw. Found live: a price-justification
        // reply's tool call quietly populated pendingOptions without ever
        // presenting it, and a later "ok" (acknowledging the
        // justification, not an offer) got treated as accepting an
        // alternative the customer was never shown — the cart got swapped
        // and checked out on it silently. facts.anyAlternativePresented is
        // set only once a reply's actual text named a real alternative
        // (see markPendingOptionsPresented), so this check can't be
        // satisfied by a tool call succeeding alone.
        if (!facts.anyAlternativePresented) {
          return {
            success: false,
            error: 'No alternative has actually been presented to the customer yet in this conversation — present one first (as a numbered list) and wait for them to choose before calling selectAlternative.',
          };
        }
        // facts.selectedAlternativeItemId, when set, was resolved in CODE
        // from the customer's own numbered reply (captureNextReply) — that
        // is always trusted over whatever itemId the model supplies, so a
        // hallucinated argument can never swap the cart to the wrong item.
        // Only falls back to the model's own args.itemId when the customer
        // picked by name/prose rather than a bare numeral, which
        // captureNextReply deliberately doesn't resolve on its own.
        const itemId = facts.selectedAlternativeItemId || String(args.itemId ?? '');
        const res = selectAlternativeTool(working, String(args.cartId ?? cartId), itemId);
        applyCartUpdate(res.cart);
        return res.output;
      },
      removeCartItem: (args) => {
        // facts.pendingCartItemRemoval, when set, was resolved in CODE from
        // the customer's own free text (resolvePartialCartRemoval) — same
        // "a captured selection wins over a hallucinated argument" rule
        // selectAlternative's executor follows above. Only falls back to
        // the model's own args.itemId when the text didn't unambiguously
        // resolve on its own (e.g. it named the item some other way).
        const itemId = facts.pendingCartItemRemoval || String(args.itemId ?? '');
        const res = removeCartItemTool(working, String(args.cartId ?? cartId), itemId);
        applyCartUpdate(res.cart);
        return res.output;
      },
      createCheckoutLink: (args) => {
        // Hard backstop, same reasoning as the selectedAlternativeItemId
        // check just below: checkout must be physically incapable of
        // running while a code-resolved partial-cart removal hasn't
        // actually landed yet — otherwise it prices the FULL original
        // cart even though the customer only wanted part of it.
        if (facts.pendingCartItemRemoval && !facts.cartItemRemovalApplied) {
          return {
            success: false,
            error: `The customer said they don't want "${facts.pendingCartItemRemovalName ?? facts.pendingCartItemRemoval}" but the cart has not been updated yet — call removeCartItem first, then createCheckoutLink.`,
          };
        }
        // Hard backstop, not just best-effort forcing: even if
        // requiredAlternativeSelectionTool somehow failed to force
        // selectAlternative first (a future regression, a retry budget
        // exhausted on something else), checkout itself must still be
        // physically incapable of running against a cart the customer just
        // moved off of. Found live: a customer accepted a presented
        // alternative ("yes" to a single-option list) and checkout still
        // went through on the ORIGINAL item at its original price, because
        // nothing at the tool-call boundary verified the swap had actually
        // happened — createCheckoutLinkTool itself has no visibility into
        // conversation state (facts), so this check has to live here,
        // where facts and the cart-mutating tools actually meet.
        if (facts.selectedAlternativeItemId && !facts.alternativeSelectionApplied) {
          return {
            success: false,
            error: `The customer chose "${facts.selectedAlternativeName ?? facts.selectedAlternativeItemId}" but the cart has not been swapped to it yet — call selectAlternative first, then createCheckoutLink.`,
          };
        }
        // Broader than the check above: a price-relevant alternatives list
        // can still be sitting there UNRESOLVED — no specific item was
        // ever captured as chosen, because the customer's reply was
        // genuinely ambiguous or the model never asked. Found live: with
        // two alternatives pending, a reply that didn't cleanly resolve to
        // either one still let checkout proceed straight through on the
        // ORIGINAL item — nothing to "unwind" because no selection was
        // ever recorded in the first place. If a price objection put
        // alternatives on the table at all, the original item's price is
        // exactly what's in question; checking out on it while that's
        // still open is the "check out an item the customer just
        // declined" case, just without an explicit selection to point at.
        if (facts.pendingOptions && PRICE_RELEVANT_ALTERNATIVE_TOOLS.has(facts.pendingOptions.tool)) {
          const list = facts.pendingOptions.items.map((it, i) => `${i + 1}) ${it.name}`).join(', ');
          return {
            success: false,
            error: `The customer hasn't confirmed which alternative they want yet (${list}) — ask which one before creating a checkout link.`,
          };
        }
        const res = createCheckoutLinkTool(
          working,
          String(args.cartId ?? cartId),
          brand.checkoutBaseUrl,
          args.discountCode ? String(args.discountCode) : undefined,
        );
        applyCartUpdate(res.cart);
        return res.output;
      },
      markCartOutcome: (args) => {
        const res = markCartOutcomeTool(
          working,
          String(args.cartId ?? cartId),
          args.outcome as LlmSettableOutcome,
          args.reason ? String(args.reason) : undefined,
        );
        applyCartUpdate(res.cart);
        return res.output;
      },
      getRecommendationsFromHistory: (args) => getRecommendationsFromHistoryTool(String(args.customerId ?? customerId)),
      getBrowseAbandonment: (args) => getBrowseAbandonmentTool(String(args.customerId ?? customerId), working),
    };
  }, [brand.checkoutBaseUrl]);

  const sendMessage = useCallback(
    async (cartId: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing) return;
      if (sendingCartIdsRef.current.has(cartId)) return;

      const cart = cartsRef.current.find((c) => c.cartId === cartId);
      const session = sessionsRef.current[cartId];
      // 'recovered'/'lost'/'checkout_sent' are genuinely closed — nothing
      // further for the AGENT to do. checkout_sent joins this list for the
      // same reason: once a link has actually been sent, the agent's job
      // is done — payment confirmation happens on the dashboard, not in
      // chat — so leaving it open just invited every subsequent "ok" to
      // re-send the same link (found live, three times in one
      // conversation). A pending customerInitiatedRecovery link closes the
      // conversation the same way, for the same reason, on the opted-out
      // path where `outcome` itself can't carry this (it stays
      // 'opted_out' permanently).
      // 'opted_out' alone (no pending link yet) is NOT a lockout: it only
      // means the BRAND can't initiate contact again (see tools.ts's
      // file-level guard comment). A message reaching this function at all
      // is by definition customer-initiated (there is no other path that
      // calls sendMessage), so an opted-out cart with no link pending
      // still gets processed normally.
      if (
        !cart ||
        cart.outcome === 'recovered' ||
        cart.outcome === 'lost' ||
        cart.outcome === 'checkout_sent' ||
        cart.customerInitiatedRecovery ||
        !session
      )
        return;

      // See sendingCartIdsRef's own comment — set/cleared synchronously
      // around this whole call, not derived from React state, so a
      // back-to-back caller (runScenario's for-loop) can never race it.
      sendingCartIdsRef.current.add(cartId);
      try {
        const facts = factsRef.current[cartId] ?? (factsRef.current[cartId] = {});

        setThreads((prev) => ({
          ...prev,
          [cartId]: {
            ...prev[cartId],
            messages: [...prev[cartId].messages, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }],
          },
        }));

        // Bounds-checked in code before this ever becomes a model turn —
        // see validatePendingChoice's own comment. No tool call, no LLM
        // request, just an immediate correction while the real question
        // stays open.
        const rejection = validatePendingChoice(facts, trimmed);
        if (rejection) {
          setThreads((prev) => ({
            ...prev,
            [cartId]: {
              ...prev[cartId],
              messages: [...prev[cartId].messages, { id: uid(), role: 'agent', text: rejection, timestamp: Date.now() }],
            },
          }));
          return;
        }

        captureNextReply(facts, trimmed);

        // A customer's own stated budget ("under ₹2000") is a real,
        // grounded number the moment they say it — recorded here so the
        // claim guard (looksLikeFabricatedPriceClaim) doesn't flag the
        // agent simply echoing it back before a tool call has independently
        // confirmed it (findAlternativesByBudget's own maxBudget field
        // covers the same case once that tool runs; this covers the
        // window before it does, e.g. an acknowledgement in the same
        // reply that also makes the tool call).
        for (const m of trimmed.matchAll(RUPEE_CLAIM_PATTERN)) {
          const value = Number(m[1].replace(/,/g, ''));
          if (Number.isFinite(value)) recordPrice(facts, value);
        }

        // Same "resolve deterministic customer intent in code before the
        // LLM ever sees it" posture as captureNextReply above, just for a
        // multi-item cart's own items instead of a freshly-presented
        // alternatives list. Skipped once a removal already landed this
        // conversation — re-resolving against the now-SHRUNK cart could
        // otherwise misfire on a later, unrelated message.
        if (cart.items.length >= 2 && !facts.cartItemRemovalApplied) {
          const resolvedRemoval = resolvePartialCartRemoval(cart.items, trimmed);
          if (resolvedRemoval) {
            facts.pendingCartItemRemoval = resolvedRemoval;
            facts.pendingCartItemRemovalName = getCatalogItem(resolvedRemoval)?.name;
          }
        }

        setThreads((prev) => ({
          ...prev,
          [cartId]: { ...prev[cartId], isTyping: true, toolActivity: THINKING_LABEL, streamingText: '' },
        }));

        try {
          const executors = buildExecutors(cartId, facts);
          // Per-turn only — a fresh `let` inside this async call, reset
          // every customer message, so a candidate from turn N can never
          // leak into turn N+1's reply. See IMAGE_SUPPRESSING_TOOLS' own
          // doc for why closing-action tools force this back to empty
          // even if a product-presenting tool ran earlier the same turn.
          let candidateImages: { image: ProductImage; number?: number }[] = [];
          let suppressImages = false;
          const reply = await sendAgentMessage(
            session,
            trimmed,
            executors,
            (name, args, result) => {
              setThreads((prev) => ({
                ...prev,
                [cartId]: { ...prev[cartId], toolActivity: TOOL_ACTIVITY_LABELS[name] ?? name },
              }));
              console.log(`[useCartRecoveryAgent] tool call (${cartId}): ${name}`, args, '->', result);
              updateFacts(facts, name, args, result);

              // Product-image attachment — deliberately keyed off the REAL
              // tool result's own itemIds (via productImageFor), never off
              // anything the model's reply text says, so an image can never
              // show a product that wasn't genuinely just returned by a
              // tool this turn. Last successful product-presenting tool
              // call this turn wins, same "most recent overwrites" rule
              // updateFacts already uses for facts.pendingOptions.
              if (IMAGE_SUPPRESSING_TOOLS.has(name)) {
                suppressImages = true;
              } else if (ALTERNATIVE_TOOLS.has(name)) {
                const r = result as { success?: boolean; items?: { itemId: string }[] } | undefined;
                if (r && r.success !== false && r.items && r.items.length > 0) {
                  const items = r.items;
                  const multi = items.length > 1;
                  const built: { image: ProductImage; number?: number }[] = [];
                  items.forEach((it, i) => {
                    const image = productImageFor(it.itemId, brand.productBaseUrl);
                    if (image) built.push({ image, number: multi ? i + 1 : undefined });
                  });
                  candidateImages = built;
                }
              } else if (name === 'getBrowseAbandonment') {
                const r = result as { success?: boolean; items?: { itemId: string }[] } | undefined;
                if (r && r.success !== false && r.items && r.items.length > 0) {
                  candidateImages = r.items
                    .map((it) => productImageFor(it.itemId, brand.productBaseUrl))
                    .filter((image): image is ProductImage => Boolean(image))
                    .map((image) => ({ image }));
                }
              }
            },
            (textSoFar) =>
              setThreads((prev) => ({ ...prev, [cartId]: { ...prev[cartId], streamingText: textSoFar } })),
            factsToSummary(facts),
            buildTurnGuardrail(trimmed, facts),
            buildInitialForcedTool(trimmed, facts),
          );
          // Only now is the REAL customer-visible text known — see
          // markPendingOptionsPresented's own comment for why this can't
          // happen any earlier (e.g. inside the tool-call callback above).
          markPendingOptionsPresented(facts, reply);

          // Only attach an image whose product the reply actually named —
          // same "the customer has to have genuinely been told" standard
          // markPendingOptionsPresented already holds pendingOptions to.
          // Guards against a guardrail-forced retry leaving a stale
          // candidate that the FINAL reply never ended up talking about.
          const imagesToAttach = suppressImages
            ? []
            : candidateImages.filter(({ image }) => repliesGenuinelyDescribe(reply, image.name));

          const now = Date.now();
          const newMessages: ChatMessage[] = imagesToAttach.map(({ image, number }, i) => ({
            id: uid(),
            role: 'agent',
            text: productImageCaption(number),
            timestamp: now + i,
            image,
          }));
          newMessages.push({ id: uid(), role: 'agent', text: reply, timestamp: now + imagesToAttach.length });

          setThreads((prev) => ({
            ...prev,
            [cartId]: {
              ...prev[cartId],
              messages: [...prev[cartId].messages, ...newMessages],
            },
          }));
        } catch (err) {
          const providerName = getActiveProvider().name;
          console.error(`${providerName} request failed`, err);
          const raw = err instanceof Error ? err.message : String(err);
          const errorText = isQuotaError(raw)
            ? 'This demo is briefly rate-limited — it clears in about a minute. Hit Reset and try again shortly.'
            : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
          setThreads((prev) => ({
            ...prev,
            [cartId]: {
              ...prev[cartId],
              messages: [...prev[cartId].messages, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }],
            },
          }));
        } finally {
          setThreads((prev) => ({
            ...prev,
            [cartId]: { ...prev[cartId], isTyping: false, toolActivity: null, streamingText: '' },
          }));
          console.log(`[useCartRecoveryAgent] facts (${cartId}) after this turn:`, JSON.stringify(facts));
        }
      } finally {
        sendingCartIdsRef.current.delete(cartId);
      }
    },
    [apiKeyMissing, buildExecutors, brand.productBaseUrl],
  );

  /** Runs a scripted scenario's customer lines one at a time, each awaiting
   * the agent's reply before the next goes out — so a live call can
   * demonstrate a full objection-handling exchange without anyone typing. */
  const runScenario = useCallback(
    async (scenario: Scenario) => {
      setActiveCartId(scenario.cartId);
      for (const turn of scenario.customerTurns) {
        await sendMessage(scenario.cartId, turn);
      }
    },
    [sendMessage],
  );

  // 'recovered' is ONLY ever reached via the dashboard's "Mark as paid"
  // control (markCartPaidTool) — the LLM cannot set it (see
  // LlmSettableOutcome) — so every recoveredCount/revenueRecovered figure
  // below is already "confirmed paid only" by construction. checkoutLink
  // persists forward once 'recovered' too, so linkSentCount counts every
  // cart that EVER had a link created — the funnel's "link sent" stage is
  // cumulative, same as every earlier stage. Revenue is always derived
  // fresh from each cart's CURRENT items via amountPaidForCart, never a
  // stored total — see AbandonedCart.checkoutDiscountApplied.
  const stats: CampaignStats = useMemo(() => computeCampaignStats(carts, threads), [carts, threads]);

  /** The same KPIs, scoped to one campaign type at a time — what the
   * dashboard's campaign-type selector and "revenue by campaign type"
   * combined view actually read. Every figure here is a live re-derivation
   * from `carts`/`threads`, same as `stats` above, just pre-filtered. */
  const statsByType: Record<CampaignType, CampaignStats> = useMemo(() => {
    const out = {} as Record<CampaignType, CampaignStats>;
    for (const type of CAMPAIGN_TYPES) {
      out[type] = computeCampaignStats(
        carts.filter((c) => c.campaignType === type),
        threads,
      );
    }
    return out;
  }, [carts, threads]);

  const reset = useCallback(() => {
    setCarts(brand.catalog);
    const initThreads = buildInitialThreads(brand.catalog, brand.productBaseUrl);
    setThreads(initThreads);
    sessionsRef.current = buildInitialSessions(brand, brand.catalog);
    factsRef.current = Object.fromEntries(brand.catalog.map((c) => [c.cartId, {} as ConversationFacts]));
    // Belt-and-suspenders: nothing should ever leave a stale entry in this
    // set (every sendMessage call clears its own on the way out, success
    // or failure), but Reset is supposed to be an unconditional clean
    // slate, not "clean unless something else already went wrong."
    sendingCartIdsRef.current.clear();
    // Found live: this is the fix for the actual reported regression — see
    // resetProviderFallback's own comment. Without this, a rate limit hit
    // once during a demo keeps routing every subsequent request to a
    // weaker fallback provider for the rest of the browser tab, Reset or
    // not, which looked exactly like an intermittent bug in the
    // price-objection enforcement but was really just always hitting a
    // different (flakier) vendor after the first 429.
    resetProviderFallback();
    setActiveCartId(brand.catalog[0].cartId);
  }, [brand]);

  /**
   * The demo-only "Mark as paid" control (CartTable.tsx) — never called by
   * the LLM (see tools.ts's file-level comment on markCartPaidTool). A
   * direct setCarts call, same shape as every other cart mutation in this
   * hook, deliberately NOT routed through sendAgentMessage/buildExecutors:
   * this represents a payment webhook firing in a real system (see
   * README), not something a chat turn produces.
   */
  const markPaid = useCallback((cartId: string) => {
    const res = markCartPaidTool(cartsRef.current, cartId);
    if (res.cart) {
      const updated = res.cart;
      setCarts((prev) => prev.map((c) => (c.cartId === updated.cartId ? updated : c)));
    }
  }, []);

  const activeThread = threads[activeCartId];

  return {
    brand,
    apiKeyMissing,
    carts,
    stats,
    statsByType,
    activeCartId,
    setActiveCartId,
    activeThread: {
      messages: activeThread?.messages ?? [],
      isTyping: activeThread?.isTyping ?? false,
      toolActivity: activeThread?.toolActivity ?? null,
      streamingText: activeThread?.streamingText ?? '',
    },
    sendMessage,
    runScenario,
    reset,
    markPaid,
  };
}
