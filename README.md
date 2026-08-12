# Kora — Cart Recovery Agent Demo

An abandoned-cart recovery agent for **Kora**, a fictional Indian fashion D2C brand. This is a sales demo for a
prospective enterprise client (a brand's growth lead): where [Vastra](../Vastra) demonstrates *support deflection*
(an inbound returns agent), this demonstrates *revenue recovery* — an outbound agent that reaches out to a customer
who abandoned a cart on WhatsApp, handles their objections, and tries to win the sale back, while a live campaign
dashboard shows the numbers a growth lead actually cares about: carts targeted, recovery rate, revenue recovered,
and average discount given.

## Setup

```bash
npm install
cp .env.example .env   # then fill in at least one API key
npm run dev
```

Five providers are supported, all optional, all free-tier — set as many as you have keys for:

| Provider | Env var | Get a key |
|---|---|---|
| Groq (tried first) | `VITE_GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) |
| Cerebras | `VITE_CEREBRAS_API_KEY` | [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| OpenRouter | `VITE_OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Mistral | `VITE_MISTRAL_API_KEY` | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) |
| SambaNova (tried last) | `VITE_SAMBANOVA_API_KEY` | [cloud.sambanova.ai/apis](https://cloud.sambanova.ai/apis) |

There's no provider switch anymore — every configured provider is tried automatically, in the order above, on a
rate limit, a network failure, a 5xx, or a 15s timeout (see `src/lib/llmProvider.ts`). One key is enough to run the
demo; more keys just make it survive a free-tier cap without anyone noticing. Every attempt is logged to the
console, including a startup check listing which providers are configured.

**Known limitation, not a bug:** SambaNova Cloud's REST API sends no CORS header, so a request from this
client-side-only app will always fail with a network error before it ever reaches SambaNova — confirmed live in the
sibling returns-agent demo, which hit the same wall with the same provider. It's included because the brief for
this hardening pass names it explicitly; as the last provider in the fallback order it's a safe no-op (a network
failure just falls through) as long as something earlier in the list is configured, but it will never actually
serve a request on its own.

### Verifying the pricing policy without the LLM

The discount engine is plain, dependency-free TypeScript and is meant to be checked on its own before ever
touching the model:

```bash
npx tsx scripts/verifyPricingPolicy.ts   # tier caps, margin floor, recency guard, one-offer guard
npx tsx scripts/verifyTools.ts           # tool-level guards: opt-out, terminal outcome, duplicate discount
```

Both are plain assert scripts (no test framework needed) run directly against the seeded carts.

## What's real vs. mocked

**Real:**
- Agent reasoning and conversational flow — five-provider automatic fallback, function calling, streaming
- Tool calling — ten tools: `getCartDetails`, `checkDiscountEligibility`, `generateDiscountCode`,
  `findSimilarItems`, `findAlternativesBySize`, `findAlternativesByBudget`, `findAlternativesByColour`,
  `getActiveSales`, `createCheckoutLink`, `markCartOutcome` — the model only ever reports what they return, and
  every alternative any of them can return is a real catalog row (see "Design decisions" below)
- The pricing policy engine (`src/lib/pricingPolicy.ts`) — tier caps, margin floor, recency and one-offer rules
- The tool-level guards (`src/lib/tools.ts`) — permanent (never-reversible) opt-out outcome, terminal-outcome
  protection, duplicate-discount refusal
- The conversation-level guards (`src/hooks/useCartRecoveryAgent.ts`) — numbered-choice bounds checking, a
  fabricated-options-list detector with a forced-retool retry, and a redundant-step diagnostic — see "Design
  decisions"
- All app state (carts, conversations, campaign stats) — genuine React state, recomputed live as tools run

**Mocked:**
- WhatsApp Business API — this is a UI built to look like a WhatsApp thread, not a WhatsApp integration
- Payments and checkout — `createCheckoutLink` returns a link in the brand's real format
  (`config/brand.ts`'s `checkoutBaseUrl`), but nothing is actually charged. Sending a link only ever moves a cart
  to `'checkout_sent'` — a distinct, non-revenue state — never `'recovered'`; see "Why sending a link isn't a
  sale" below for how confirmation is stood in for
- Inventory and stock levels — `inStock`/`onSale` are static seed-data flags, not a live inventory feed
- The outbound send itself — the "campaign" is pre-seeded (every cart already has an authored opening message);
  there's no actual message-sending infrastructure behind it

## Design decisions

**Why the discount policy is deterministic code, not prompt instructions.** A brand cannot let a language model
invent discounts — a large enough conversation, an unusual phrasing, or a model having an off day can talk it into
a number nobody approved. `src/lib/pricingPolicy.ts` is pure, dependency-free TypeScript: tier caps by cart value,
a margin floor the tier cap can never override, a 15-minute abandonment-age minimum, and a hard one-offer-per-cart
rule. The model calls `checkDiscountEligibility`/`generateDiscountCode` and relays whatever comes back — it never
computes a percentage itself, and the system prompt explicitly forbids stating one before the tool confirms it.
These functions are verified directly against the seeded carts with no LLM involved (see `scripts/verifyPricingPolicy.ts`)
before any model integration was written, per the build order this project followed.

**Why the guards live in the tools, not the system prompt.** Telling the model "only offer one discount" is
necessary but not sufficient — a long enough conversation, or a customer asking three different ways, can talk a
model into repeating an action it was told not to repeat. So the actual enforcement is in `src/lib/tools.ts`:
`generateDiscountCode` refuses a second call for the same cart, `markCartOutcome` refuses to overwrite a terminal
outcome — including `opted_out`, which is what makes an opt-out permanent (see below) — and `createCheckoutLink`
refuses once a checkout link already exists for the cart, whether that cart is `'checkout_sent'` (unpaid) or
`'recovered'` (paid) — so a repeated "ok" mid-conversation can never re-send or duplicate a link. Each refusal is a
normal `{ success: false, error }` tool result
the agent can relay in plain language, never a thrown exception — a guard should degrade the conversation
gracefully, not crash it.

**Why opt-out is directional, not a lockout.** An earlier version made opt-out a full stop — the moment a cart was
marked `opted_out`, every tool for it refused outright and the chat input disabled itself, on the reasoning that
"no further contact" meant no further anything. That over-corrected what opt-out actually means: real consent
withdrawal (and WhatsApp's own 24-hour customer-service-window model, which this demo deliberately mirrors) blocks
the *brand* from initiating again — it doesn't revoke the customer's own ability to write in whenever they want.
The fix has three parts, each enforced in a different place because each is a different kind of guarantee:
- **The brand literally cannot re-initiate**, by construction rather than by a runtime check: every tool call in
  this app happens inside `useCartRecoveryAgent.ts`'s `sendMessage`, which only ever runs in response to a
  customer message (typed, or a scripted `Scenario` turn standing in for one) — there is no timer, poll, or other
  path that could message a cart on the brand's own initiative. So relaxing the tool-level opt-out refusals (see
  `tools.ts`'s file-level guard comment) doesn't reopen a hole; the guarantee was never "the tools refuse," it was
  always "nothing calls them unprompted."
- **The customer can still write in and get a normal reply** — `sendMessage` only blocks carts whose conversation
  is genuinely done: `'recovered'`, `'lost'`, `'checkout_sent'` (a link is already out — see the next section), or
  an opted-out cart with a checkout link already pending. Plain `'opted_out'` with nothing pending yet still gets a
  normal reply, and `ChatPanel.tsx` keeps the input enabled for it too. The system prompt's OPT-OUT rule tells the
  model this is the customer re-opening the conversation, not license to resume the original pitch — answer what
  they actually asked, nothing unprompted.
- **The opt-out itself never gets undone**, even if that reply ends in a sale: `markCartOutcomeTool`'s existing
  terminal-outcome guard already refuses to move `outcome` away from `'opted_out'` for any reason, including a
  completed purchase — nothing new was needed there. What *is* new is `createCheckoutLinkTool` tagging a
  purchase made this way as `customerInitiatedRecovery` (a separate field — see `AbandonedCart`), which carries
  its own `paid` flag (see "Why sending a link isn't a sale" below) so the campaign dashboard can tell it apart
  from a normal campaign-driven recovery — see the next entry.

**Why customer-initiated recovery is a separate number, not folded into "Recovered."** `revenueRecovered`,
`recoveredCount`, and the recovery funnel all exist to answer one question: *is the outbound campaign working?*
A sale that happened because an opted-out customer messaged back in on their own answers a completely different
question, and crediting it to the campaign would overstate what the outreach actually achieved — the message that
supposedly "recovered" that cart was never sent. So `CampaignStats` carries `customerInitiatedRecoveredRevenue`/
`customerInitiatedRecoveredCount` as their own fields (counting only *paid* customer-initiated links — an unpaid
one shows up in "Pending checkout" instead, same as any other cart awaiting payment), shown as their own tile in
the dashboard's secondary stats strip, and the cart's outcome badge reads "Opted out · bought" once paid —
deliberately still the neutral grey every other opted-out row gets, never the accent green reserved for a real
campaign win, so the color alone tells you it isn't one before you've read a single label.

**Why sending a checkout link isn't a sale.** Found live: a customer said "ok," got a checkout link, and the cart
was immediately marked `'recovered'` with the full amount added to Revenue Recovered — nobody had paid anything.
Sending a link is intent, not a confirmed transaction, so the state model now says so explicitly:
`createCheckoutLinkTool` only ever produces `'checkout_sent'` — a distinct, non-revenue outcome — and
`markCartOutcomeTool`'s parameter type (`LlmSettableOutcome`, `types.ts`) excludes `'recovered'` entirely, so the
LLM cannot reach it even by mistake, not just "is refused if it tries." The only path to `'recovered'` is
`markCartPaidTool`, which backs the campaign dashboard's demo-only **Mark as paid** control on each cart row (the
same "advance status by hand" pattern [Vastra](../Vastra) uses for its own order-status chevron) — never something
the model can call. `revenueRecovered` and `recoveryRate` (`useCartRecoveryAgent.ts`'s `CampaignStats`) only ever
sum `outcome === 'recovered'` carts, which is correct by construction once the LLM literally cannot set that value
itself. A separate `pendingCheckoutValue` figure and a "Link sent" funnel stage (between "Replied" and "Paid")
account for the money that's been quoted but not yet confirmed, so it's visible without being counted as won.
**In a production system**, this confirmation would come from a **payment webhook** — the payment provider (Razorpay,
Stripe, etc.) calling back into the backend once a transaction actually clears, which would then call the
equivalent of `markCartPaidTool` itself. There is no backend here to receive that webhook, so the dashboard button
stands in for it; the point of separating `checkout_sent` from `recovered` in the data model is that swapping the
manual button for a real webhook handler later is a one-line change at the call site, not a redesign of what
"recovered" means.

**Why alternatives are found, never generated.** `findSimilarItems`, `findAlternativesBySize`,
`findAlternativesByBudget`, `findAlternativesByColour`, and `getActiveSales` are all `.filter()`/`.map()` calls over
the same static `catalog` array (`src/data/catalog.ts`) — the model can misjudge which tool to call, or pass a bad
argument, but it structurally cannot make any of them return a product, price, size, or colour that doesn't exist
in the catalog. Catalog items carry per-size stock (`sizes` + `outOfStockSizes`, so an item can be `inStock: true`
overall while sold out in one specific size) and a single `colour` — there are no synthetic "variants," so "same
item in another colour" always resolves to a genuinely different, real catalog row. `getActiveSales` is checked
*before* minting a fresh discount code on a price objection, deliberately: a real sale item costs the brand nothing
extra, where every `generateDiscountCode` call cuts into margin.

**Why the fact-tracking state machine, and why it's ported from Vastra almost unchanged.** The context-window
optimization in `llmProvider.ts` (`buildRequestMessages`) only sends the model a bounded recent-message window per
request, not the whole growing transcript — necessary so a long cart conversation doesn't burn an ever-larger
token/rate-limit budget on facts already established. The trade-off is that anything older than that window is
invisible to the model unless something else remembers it. Vastra hit this as a recurring, specific bug (the model
re-asking for an order ID, re-listing pickup slots, forgetting a discount code it already generated) before
building `ConversationFacts` — a single per-conversation object that's the only source of truth for what's already
known, with everything else (the recap sent to the model, which tool a stale numbered reply should resolve
against, whether a step is being redundantly redone) computed FROM it rather than tracked separately. Cart recovery
is a different shape of conversation (objection handling, not a linear intake wizard), so the fields differ, but
the mechanism is identical: `factsRef` in `useCartRecoveryAgent.ts`. Three concrete guards fall out of this:
- **Numbered-choice bounds checking** (`validatePendingChoice`) — if the customer's whole reply is a bare number
  and it's outside the range of whatever alternatives were just presented, the message never reaches the model at
  all; a direct correction is shown and the real question stays open. Without this, a model asked to resolve an
  out-of-range choice tends to just pick something plausible instead of asking again.
- **Fabricated-options-list detection** (`looksLikeFabricatedOptionsList` + `sendAgentMessage`'s `guardrail`
  param) — if a reply reads like a numbered list (2+ list markers) but no alternative-finding tool was actually
  called that turn, the reply is discarded before the customer ever sees it and retried exactly once with that
  tool forced via `tool_choice`. Catches the model writing a plausible-looking "here are 3 options" from nothing.
- **Redundant-step diagnostic** (`checkForRedundantStep`) — logs a loud `console.error` the moment a tool is
  called again for a fact `facts` already has recorded (cart details re-fetched, eligibility re-checked, etc.).
  This doesn't block anything by itself — `tools.ts`'s own guards are what actually stop a wrong action — it's the
  visibility layer that makes an attempt obvious in the console instead of only surfacing as an odd reply.

**Why the campaign dashboard doesn't look like the returns console.** An early pass reused Vastra's ops-console
layout almost verbatim (header, equal stat tiles, a bordered table) with only the accent color swapped — sitting
side by side, the two demos read as one product family, which undercuts the whole point of showing two different
use cases. The dashboard was reworked around what a *growth* audience actually scans for: revenue recovered and
recovery rate get an oversized, dark "hero" treatment (`HeroStats.tsx`) instead of sitting equal-weight with four
other numbers; a recovery funnel (`RecoveryFunnel.tsx`) gives the campaign a shape a support ops console has no
reason to show; the remaining metrics are demoted into a dense, chrome-free numeric strip; and the palette leans
into Kora's "clay" half (dark ink header, warm parchment background) rather than the sage-on-grey treatment shared
with the chat panel. The chat panel itself is untouched — differentiation is scoped entirely to the half of the
screen that's actually a different kind of product.

**Why the split screen.** Nobody sees both panels in real life — the customer sees WhatsApp, the brand sees a
dashboard. Showing them side by side is how a buyer in a sales call understands that the two are the same
conversation viewed from opposite sides: every tool call on the left is a number changing on the right, live.

**Why the opening message is authored, not generated.** The brief for this demo treats the first outbound message
as the hardest part to get right — it has to name a specific item and give an honest reason to act, never a
generic "you left something behind!" nudge. Rather than trust a small free-tier model to hit that bar consistently
under live-demo conditions, each cart's opening line is written by hand in `src/data/carts.ts` and seeded directly
into the model's own conversation transcript (see `useCartRecoveryAgent.ts`) so objection-handling still has full
context of what was "said." The LLM's job — and the part genuinely demonstrated live — is everything that happens
*after* the customer replies, which can't be scripted in advance.

**Why the provider layer is shared with the returns demo.** `src/lib/llmProvider.ts` is the only file in this app
that knows which LLM vendor is behind the agent — ported from [Vastra](../Vastra)'s own hardened version rather
than reinvented. Five providers, tried automatically in a fixed order, falling back to the next one on a rate
limit, a network-level failure (`fetch()` itself throwing — CORS, DNS, "Failed to fetch"), a 5xx, or a 15-second
timeout; anything else (a bad request, an auth failure) surfaces immediately instead of being silently retried, so
a real bug never masquerades as flakiness. Swapping a vendor, or adding a sixth, is a one-file change — the hook,
the tools, and the UI never import a vendor name.

**Why contact details live in brand config, not the prompt.** `koraBrand.supportEmail`/`supportPhone`/
`supportHours` (`src/config/brand.ts`) exist so "how do I reach a human" has a real, code-owned answer. The system
prompt's CONTACT DETAILS rule limits the agent to exactly those channels plus the WhatsApp number it's already
texting from — nothing else exists for it to invent. Same principle as the pricing engine: a fact the model is
allowed to state should come from somewhere other than the model's own judgment whenever that's feasible.

## Project structure

```
src/
  config/brand.ts        Brand identity, colors, agent persona/tone, support contact details
  data/catalog.ts         Product catalog — prices, fabric, margin, stock/sale flags, sizes, colours
  data/carts.ts            16 seeded abandoned carts, authored opening messages, edge cases
  data/scenarios.ts       11 scripted "Play scenario" objection paths
  lib/pricingPolicy.ts    Deterministic discount rules — pure functions, no LLM
  lib/tools.ts             Tool implementations + guards, closed over current cart/catalog state
  lib/llmProvider.ts      5-provider fallback + streaming function-calling loop (no vendor name elsewhere)
  lib/systemPrompt.ts     The conversational script (not the pricing rules)
  lib/formatText.ts       WhatsApp *bold* markdown rendering
  hooks/useCartRecoveryAgent.ts   Per-cart conversations, campaign state, fact-tracking state machine
  components/             Chat UI + campaign dashboard
scripts/
  verifyPricingPolicy.ts  Pure policy checks, no LLM, no React
  verifyTools.ts          Tool-guard + smarter-alternative checks, no LLM, no React
```
