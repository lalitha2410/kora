/**
 * The ONLY module in the app that knows which LLM vendor(s) are behind the
 * agent. `useCartRecoveryAgent.ts` (state), `tools.ts` (executors) and
 * `pricingPolicy.ts` (discount rules) never import from here directly
 * except for the exports below — swapping vendors, or adding another one,
 * means rewriting this one file, not touching the hook, the tools, or the
 * UI.
 *
 * Five providers, tried automatically in a fixed fallback order — see
 * PROVIDER_ORDER and streamChatCompletion. All five are OpenAI-compatible
 * chat-completions APIs, so they share one request/parsing path
 * (streamProviderOnce) — unlike Vastra (the returns-agent demo this one's
 * infrastructure is ported from), which also carries a Gemini adapter for
 * its fifth slot; that adapter isn't needed here because this fallback
 * order's fifth provider (SambaNova) is OpenAI-shaped too. Any provider
 * with no API key configured is skipped entirely (see
 * getConfiguredProviders); this only exists so a live demo session doesn't
 * die the moment one free-tier daily cap is hit. Fallback triggers on a
 * rate-limit/quota response, a network-level failure (fetch() itself
 * throwing — CORS, DNS, connection refused, "Failed to fetch"), a 5xx
 * server error, or a request that doesn't complete within the 15s timeout —
 * see isRetryableProviderError — since all four symptoms mean "this vendor
 * isn't answering right now, try the next one." Anything else (bad
 * request, auth failure, a genuine bug) surfaces immediately instead of
 * being silently retried on a different vendor, so a real bug doesn't
 * masquerade as flakiness.
 *
 * - Groq (`openai/gpt-oss-20b`) — tried first. The fastest of the five
 *   (LPU inference) and the most extensively validated against this app's
 *   system prompt.
 *
 * - Cerebras (`gpt-oss-120b`) — tried second. Same gpt-oss family as Groq
 *   (OpenAI's own open-weight models), just the larger 120b variant.
 *
 * - OpenRouter (`openai/gpt-oss-20b:free`) — tried third. One of the few
 *   OpenRouter free-tier models whose `supported_parameters` list includes
 *   `tools`/`tool_choice` (most free models don't support function calling
 *   at all).
 *
 * - Mistral (`mistral-small-latest`) — tried fourth. Function calling is
 *   supported across Mistral's current general-purpose lineup; Small is
 *   the cheapest/fastest model in that confirmed-supported set — this
 *   fallback tier only needs "answers reliably", not frontier reasoning.
 *
 * - SambaNova Cloud (`Meta-Llama-3.3-70B-Instruct`) — tried last, per this
 *   project's brief. Flagged here rather than silently swapped for
 *   something else: SambaNova Cloud's REST API sends no
 *   `Access-Control-Allow-Origin` header, so a request from this app (a
 *   client-side-only SPA with no backend to proxy through) fails the CORS
 *   preflight before it ever reaches SambaNova — confirmed in the sibling
 *   returns-agent demo, which tried this exact provider/model first and
 *   hit the same wall live (a browser-context `fetch()` to SambaNova's
 *   `/chat/completions` throws `TypeError: Failed to fetch`). That
 *   `TypeError` is itself one of this file's retryable-error conditions
 *   (see isRetryableProviderError), so a SambaNova attempt fails exactly
 *   like a dead network connection would — safe, but as the last
 *   configured provider it has nowhere left to fall back to. Included
 *   because the brief asks for it by name and env var; if it's ever the
 *   only configured provider, `hasApiKey()` will still report true but
 *   every request will fail. Worth knowing before relying on it alone.
 */

type LlmProviderName = 'groq' | 'cerebras' | 'openrouter' | 'mistral' | 'sambanova';

/** Fixed fallback order — every configured provider is tried automatically,
 * in this order, per request. */
const PROVIDER_ORDER: LlmProviderName[] = ['groq', 'cerebras', 'openrouter', 'mistral', 'sambanova'];

interface ProviderSpec {
  name: LlmProviderName;
  url: string;
  model: string;
  apiKey: string | undefined;
  headers: Record<string, string>;
  /** Same idea on every provider here — trade reasoning depth for latency,
   * since this agent only needs to pick the right tool and phrase a short
   * reply — but not all of them spell it the same way: OpenRouter wants a
   * nested `reasoning` object; Groq and Cerebras (both following OpenAI's
   * own gpt-oss param naming directly) want a flat `reasoning_effort`
   * string; Mistral and SambaNova's models here have no equivalent knob,
   * so this is just empty for them. */
  reasoningParam: Record<string, unknown>;
}

function buildProviderSpec(name: LlmProviderName): ProviderSpec {
  if (name === 'cerebras') {
    const key = import.meta.env.VITE_CEREBRAS_API_KEY;
    return {
      name,
      url: 'https://api.cerebras.ai/v1/chat/completions',
      model: 'gpt-oss-120b',
      apiKey: key,
      headers: { Authorization: `Bearer ${key ?? ''}`, 'Content-Type': 'application/json' },
      reasoningParam: { reasoning_effort: 'low' },
    };
  }
  if (name === 'openrouter') {
    const key = import.meta.env.VITE_OPENROUTER_API_KEY;
    return {
      name,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-oss-20b:free',
      apiKey: key,
      headers: {
        Authorization: `Bearer ${key ?? ''}`,
        'Content-Type': 'application/json',
        'X-Title': 'Cart Recovery Agent Demo',
      },
      reasoningParam: { reasoning: { effort: 'low' } },
    };
  }
  if (name === 'mistral') {
    const key = import.meta.env.VITE_MISTRAL_API_KEY;
    return {
      name,
      url: 'https://api.mistral.ai/v1/chat/completions',
      model: 'mistral-small-latest',
      apiKey: key,
      headers: { Authorization: `Bearer ${key ?? ''}`, 'Content-Type': 'application/json' },
      reasoningParam: {},
    };
  }
  if (name === 'sambanova') {
    const key = import.meta.env.VITE_SAMBANOVA_API_KEY;
    return {
      name,
      url: 'https://api.sambanova.ai/v1/chat/completions',
      model: 'Meta-Llama-3.3-70B-Instruct',
      apiKey: key,
      headers: { Authorization: `Bearer ${key ?? ''}`, 'Content-Type': 'application/json' },
      reasoningParam: {},
    };
  }
  const key = import.meta.env.VITE_GROQ_API_KEY;
  return {
    name,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-20b',
    apiKey: key,
    headers: { Authorization: `Bearer ${key ?? ''}`, 'Content-Type': 'application/json' },
    reasoningParam: { reasoning_effort: 'low' },
  };
}

/** Providers with a configured, non-empty API key, in fallback order.
 * Empty means no provider is usable at all — see hasApiKey/ApiKeyNotice. */
function getConfiguredProviders(): ProviderSpec[] {
  return PROVIDER_ORDER.map(buildProviderSpec).filter((p) => Boolean(p.apiKey && p.apiKey.trim().length > 0));
}

export function hasApiKey(): boolean {
  return getConfiguredProviders().length > 0;
}

/** Display-only info about a provider, so the UI (missing-key screen, chat
 * placeholder) never hardcodes a vendor name — it asks this module, same
 * as everything else that needs to know which vendor is live. Only ever
 * rendered when hasApiKey() is false (no provider configured at all), so
 * this always points at the first provider in fallback order. */
export interface ProviderDisplayInfo {
  name: string;
  keyUrl: string;
  envVarName: string;
}

const PROVIDER_DISPLAY: Record<LlmProviderName, ProviderDisplayInfo> = {
  groq: { name: 'Groq', keyUrl: 'https://console.groq.com/keys', envVarName: 'VITE_GROQ_API_KEY' },
  cerebras: { name: 'Cerebras', keyUrl: 'https://console.cerebras.ai', envVarName: 'VITE_CEREBRAS_API_KEY' },
  openrouter: { name: 'OpenRouter', keyUrl: 'https://openrouter.ai/keys', envVarName: 'VITE_OPENROUTER_API_KEY' },
  mistral: { name: 'Mistral', keyUrl: 'https://console.mistral.ai/api-keys', envVarName: 'VITE_MISTRAL_API_KEY' },
  sambanova: { name: 'SambaNova', keyUrl: 'https://cloud.sambanova.ai/apis', envVarName: 'VITE_SAMBANOVA_API_KEY' },
};

export function getActiveProvider(): ProviderDisplayInfo {
  return PROVIDER_DISPLAY[PROVIDER_ORDER[0]];
}

/**
 * Logs which providers are usable exactly once, at module load, so it's
 * always the first thing a fresh console shows before any request is
 * made — the fastest way to debug "fallback isn't triggering", where the
 * actual cause is almost always an env var that never made it into the
 * running build. Never logs a key's value, only whether one was found.
 */
function logProviderConfigAtStartup(): void {
  const lines = PROVIDER_ORDER.map((name) => {
    const spec = buildProviderSpec(name);
    const envVarName = PROVIDER_DISPLAY[name].envVarName;
    const found = Boolean(spec.apiKey && spec.apiKey.trim().length > 0);
    return `  ${found ? '✓' : '✗'} ${name} (${envVarName}): ${found ? 'configured' : 'MISSING — this provider will be skipped'}`;
  });
  const configured = getConfiguredProviders();
  console.log(
    `[llmProvider] startup provider check —\n${lines.join('\n')}\nFallback order for this session: ${
      configured.length > 0
        ? configured.map((p) => p.name).join(' -> ')
        : '(none — hasApiKey() is false, ApiKeyNotice will show)'
    }`,
  );
}
logProviderConfigAtStartup();

// --- OpenAI-style tool declarations (all five providers here are
// OpenAI-compatible chat-completions APIs, so tools are described the same
// way regardless of which one answers). Kora's 13 sales tools — the
// original 10 cart-recovery tools (6 conversation/checkout tools plus the
// 4 smarter-alternative tools), removeCartItem (multi-item partial
// selection), plus 2 more backing the two profile-driven campaign triggers
// (recommendations, browse-abandonment) — see lib/tools.ts for the
// implementations these names map to. ---

interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ToolDeclaration {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

const toolDeclarations: ToolDeclaration[] = [
  {
    type: 'function',
    function: {
      name: 'getCartDetails',
      description:
        'Get full details of an abandoned cart: items, prices, fabric, whether an item is on sale or out of stock, cart value, and current outcome. Call this first in almost every conversation before saying anything specific about the cart.',
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID, e.g. "CART-001".' },
        },
        required: ['cartId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkDiscountEligibility',
      description:
        'Deterministically check whether this cart is eligible for a discount right now, and if so the maximum percentage allowed. ALWAYS call this before offering or even mentioning a discount amount — never guess or promise a number yourself.',
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID.' },
        },
        required: ['cartId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateDiscountCode',
      description:
        'Generate a one-time discount code for this cart at the maximum eligible percentage. Only call this once eligibility has been confirmed AND the customer has actually raised price as a concern. Will refuse if a code was already generated for this cart — never call it twice.',
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID.' },
        },
        required: ['cartId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findSimilarItems',
      description:
        'Find in-stock items in the same category at or below a given price — used to recommend a cheaper alternative when a discount is not available or the customer wants something less expensive but has NOT stated a specific budget number.',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'The catalog item ID to find alternatives for.' },
          maxPrice: { type: 'number', description: 'The maximum price (INR) the alternative should be at or under.' },
        },
        required: ['itemId', 'maxPrice'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findAlternativesBySize',
      description:
        'Find in-stock items in the same category that are genuinely available in a specific size right now. Use this when the objection is fit, or when getCartDetails/checkDiscountEligibility reveals the item is out of stock in the customer\'s size.',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'The catalog item ID to find alternatives for.' },
          size: { type: 'string', description: 'The size the customer actually needs, e.g. "L" or "32".' },
        },
        required: ['itemId', 'size'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findAlternativesByBudget',
      description:
        'Find in-stock items in the same category at or under a budget the customer explicitly stated (e.g. "similar under ₹1500"). Use this instead of findSimilarItems whenever the customer names a specific number.',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'The catalog item ID to find alternatives for.' },
          maxBudget: { type: 'number', description: 'The exact budget (INR) the customer stated.' },
        },
        required: ['itemId', 'maxBudget'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'findAlternativesByColour',
      description:
        'Find in-stock items in the same category in a different colour — used when the customer objects to the colour/style of the item in their cart.',
      parameters: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'The catalog item ID to find alternatives for.' },
          excludeColour: { type: 'string', description: 'The colour the customer does NOT want, e.g. "Clay".' },
        },
        required: ['itemId', 'excludeColour'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getActiveSales',
      description:
        'Get items that are genuinely on sale right now, optionally scoped to one category. ALWAYS call this before generating a new discount code when the customer objects to price — a real sale item costs the brand nothing extra, so it should be surfaced first if one actually fits.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category to scope the sale search to, e.g. "Dress". Omit to see every sale item.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'selectAlternative',
      description:
        "Swap the cart's item to one of the alternatives you already presented, once the customer picks one (by number or by name). Call this BEFORE replying — it's what actually changes the cart, so pricing and checkout reflect the NEW item, not the original. Refuses once a checkout link already exists for this cart.",
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID.' },
          itemId: { type: 'string', description: "The chosen alternative's catalog item ID, exactly as returned by the tool that listed it." },
        },
        required: ['cartId', 'itemId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'removeCartItem',
      description:
        "Remove ONE item from a multi-item cart when the customer says they only want part of what's in it (e.g. 'just the co-ord set, not the top'). Call this BEFORE replying — it's what actually updates the cart so pricing and checkout reflect only what they still want, not the original full cart. Refuses if it would leave the cart with zero items (use markCartOutcome(\"lost\") instead if they want none of it), or once a checkout link already exists.",
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID.' },
          itemId: { type: 'string', description: 'The catalog item ID of the item to REMOVE (the one they do NOT want), exactly as returned by getCartDetails.' },
        },
        required: ['cartId', 'itemId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createCheckoutLink',
      description:
        "Create a checkout link once the customer has agreed to complete the purchase. Pass the discount code only if one was actually generated in this conversation and the customer accepted it. This records intent to buy, NOT a completed sale — do not call markCartOutcome after this, and do not tell the customer the order is confirmed. Payment is confirmed separately, outside this conversation.",
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID.' },
          discountCode: { type: 'string', description: 'The discount code, if one was offered and accepted.' },
        },
        required: ['cartId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'markCartOutcome',
      description:
        "Record a non-sale outcome for this cart: 'lost' when the customer declines or already bought elsewhere, 'opted_out' the moment the customer asks to stop being contacted. There is no 'recovered' value here — a checkout link is intent, not a confirmed sale, so this tool can never mark a cart recovered; that only happens once payment is actually confirmed, outside this conversation. This is terminal — do not call it more than once per cart, and never call any other tool for a cart after marking it opted_out.",
      parameters: {
        type: 'object',
        properties: {
          cartId: { type: 'string', description: 'The cart ID.' },
          outcome: {
            type: 'string',
            enum: ['lost', 'opted_out'],
            description: 'The outcome.',
          },
          reason: {
            type: 'string',
            description: 'Short reason, mainly for "lost" and "opted_out" (e.g. "already bought elsewhere").',
          },
        },
        required: ['cartId', 'outcome'],
      },
    },
  },
  // -- Recommendations (Trigger 1) --
  {
    type: 'function',
    function: {
      name: 'getRecommendationsFromHistory',
      description:
        "Get real catalog items that genuinely complement this customer's actual past purchases — filtered to items they don't already own, their known size, and their typical spend band. Call this to suggest something new; never invent a recommended item or price yourself. Results present exactly like any other alternatives list (numbered, then selectAlternative once they pick one).",
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: "The customer's ID." },
        },
        required: ['customerId'],
      },
    },
  },
  // -- Browse-abandonment (Trigger 2) --
  {
    type: 'function',
    function: {
      name: 'getBrowseAbandonment',
      description:
        "Get items this customer viewed repeatedly (3+ times) without buying and without it being in an active cart. Call this before referencing anything about what someone was browsing — never guess or say 'I noticed you looking at X' from anything other than this tool's own result, and keep the tone light — reference the item itself (e.g. it's back in their size, or popular), never the act of watching them browse.",
      parameters: {
        type: 'object',
        properties: {
          customerId: { type: 'string', description: "The customer's ID." },
        },
        required: ['customerId'],
      },
    },
  },
];

export type ToolExecutor = (args: Record<string, unknown>) => unknown;
export type ToolExecutorMap = Record<string, ToolExecutor>;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Stateless REST APIs need the caller to resend context each turn — this is
 * the complete local record of one conversation (one per cart — see
 * useCartRecoveryAgent.ts), held for its lifetime. It is NOT what gets sent
 * on the wire, though: see buildRequestMessages, which sends a bounded
 * recent-message window plus a summary instead of resending this whole
 * array every round trip.
 */
export interface ChatSession {
  messages: ChatCompletionMessage[];
}

export function newChatSession(systemInstruction: string): ChatSession {
  return { messages: [{ role: 'system', content: systemInstruction }] };
}

interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  /** Which provider actually answered — surfaced so a caller-side guardrail
   * (see sendAgentMessage's `guardrail` param) can log which provider it
   * had to correct, not just that a correction happened. */
  servedBy: LlmProviderName;
}

/** How many non-system messages to send verbatim — enough to cover the
 * customer's most recent answer plus the immediately preceding tool round
 * trip, everything older is represented by the caller's summary instead.
 * This is the context-window optimization: without it, a long-running cart
 * conversation resends its ENTIRE tool-call history every single turn,
 * burning tokens (and rate-limit budget) on facts already established and
 * already summarized — see buildRequestMessages. */
const RECENT_MESSAGE_WINDOW = 6;

/**
 * Builds what actually gets sent over the wire: the system prompt, an
 * optional one-line recap of facts established earlier in the
 * conversation, then only the most recent messages — not the full,
 * ever-growing `chat.messages` array. `chat.messages` itself is untouched
 * by this (still a complete local record); only the per-request payload is
 * bounded, which is what the token/rate-limit budget actually cares about.
 *
 * The cutoff always lands on a `user` message boundary, never mid-way
 * through a tool-call/tool-response pair — slicing at an arbitrary index
 * could send an orphaned `tool` message with no matching preceding
 * `assistant` tool_calls, which every OpenAI-compatible API rejects. Each
 * turn's tool round trip is fully contained between one `user` message and
 * the next, so walking forward from the naive cutoff to the next `user`
 * message is always safe and never discards more than necessary.
 *
 * The summary is deliberately opaque here — this module has no idea what
 * "cart" or "discount" mean, and shouldn't (see the file-level comment).
 * It's just a caller-supplied string slotted in as an extra system
 * message; the cart-recovery-domain logic that builds it lives entirely in
 * useCartRecoveryAgent.ts.
 */
function buildRequestMessages(fullHistory: ChatCompletionMessage[], contextSummary?: string): ChatCompletionMessage[] {
  const [systemMsg, ...rest] = fullHistory;
  let cutoff = Math.max(0, rest.length - RECENT_MESSAGE_WINDOW);
  while (cutoff < rest.length && rest[cutoff].role !== 'user') cutoff += 1;
  const recent = rest.slice(cutoff);

  if (!contextSummary) return [systemMsg, ...recent];
  const summaryMsg: ChatCompletionMessage = {
    role: 'system',
    content: `Context established earlier in this conversation (do not re-ask for these): ${contextSummary}`,
  };
  return [systemMsg, summaryMsg, ...recent];
}

/** Matches the same rate-limit/quota wording useCartRecoveryAgent.ts's own
 * isQuotaError check looks for. One of four conditions that trigger
 * automatic provider fallback — see isRetryableProviderError. */
function isRateLimitOrQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return message.includes('429') || lower.includes('quota') || lower.includes('rate limit');
}

/** Matches an HTTP error this module's own `throw new Error(...)` phrases
 * as "<provider> request failed: <status> <statusText> <body>" — see
 * streamProviderOnce. A 5xx is the provider's own infrastructure failing,
 * not anything about this request; retryable on the next provider exactly
 * like a rate limit is. */
function isServerError(message: string): boolean {
  return /request failed: 5\d\d\b/.test(message);
}

/** The failure classes that trigger automatic provider fallback (see
 * streamChatCompletion):
 *  - an explicit rate-limit/quota response
 *  - a network-level failure where fetch() never got a response at all
 *    (CORS block, DNS failure, connection refused, "Failed to fetch",
 *    "ERR_CONNECTION_CLOSED", offline) — browsers reject fetch()'s own
 *    promise with a TypeError for this case specifically
 *  - a request that didn't complete within the timeout (see
 *    withTimeoutSignal) — surfaces as a DOMException named "AbortError"
 *  - a 5xx from the provider's own infrastructure
 * Anything else (bad request, auth failure, a genuine bug in the request
 * body) surfaces immediately instead of being silently retried on a
 * different vendor, so a real bug doesn't masquerade as "it just worked
 * eventually." */
function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return isRateLimitOrQuotaError(message) || isServerError(message);
}

/** Every provider attempt gets this long before it's treated as unreachable
 * and fallback moves to the next one — a hung connection (not a clean
 * error, just silence) would otherwise stall the whole conversation
 * indefinitely instead of moving on. */
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Matches the specific 400 an OpenAI-compatible API returns when
 * `tool_choice` is set to a forced/named function and the model doesn't
 * support that — found live: OpenRouter's `openai/gpt-oss-20b:free`
 * rejects it outright ("inference-enforced tool_choice (required/named) is
 * not supported for model gpt-oss-20b"), and this used to be fatal —
 * `isRetryableProviderError` has no reason to treat a 400 as retryable (a
 * 400 is normally a real bug in the request), so it killed the whole
 * fallback chain instead of just meaning "this one model can't be forced."
 * Deliberately broad (400 + the substring "tool_choice", not the exact
 * OpenRouter wording) since different providers are expected to phrase
 * their own version of this differently — see streamProviderOnce, the only
 * caller.
 */
function isUnsupportedToolChoiceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('400') && /tool_choice/i.test(message);
}

/**
 * Providers discovered, this session, to reject a forced `tool_choice` —
 * see streamProviderOnce. A genuine model capability, not a transient rate
 * state, so unlike `stickyProviderIndex` this is deliberately NOT reset by
 * resetProviderFallback()/the app's Reset button: re-discovering the same
 * limitation would just waste a request repeating a 400 we already know is
 * coming. It resets on its own on a full page reload, which is enough.
 */
const providersWithoutForcedToolChoice = new Set<LlmProviderName>();

/** Index into getConfiguredProviders() to try first. Starts at 0 (highest-
 * priority configured provider) and only ever moves forward on its own —
 * once a provider rate-limits there's no point re-trying it on the very
 * next request, so this remembers "skip straight to the one that's still
 * working." Module-level, not component state: found live that this is
 * exactly what made a rate limit feel "sticky" across a Reset click — the
 * app's Reset rebuilds every piece of React state and every ref the hook
 * owns, but this variable lives in a different module entirely and Reset
 * never touched it, so once Groq took one 429 (a per-MINUTE cap, which
 * genuinely does clear on its own well within a demo session) every
 * request for the rest of the browser tab kept skipping straight past it
 * to a weaker fallback, Reset or not, looking exactly like an
 * intermittent regression rather than the deterministic session-scoped
 * behavior it actually was. See resetProviderFallback, which
 * useCartRecoveryAgent.ts's reset() now calls specifically to close this. */
let stickyProviderIndex = 0;

/** Give every configured provider another chance, starting from the top,
 * on the next request — called from useCartRecoveryAgent.ts's reset() so
 * hitting Reset is a genuine clean slate, not just for cart/conversation
 * state but for which vendor gets tried first too. Cheap even when nothing
 * was actually stuck: the worst case is one extra 429 on a provider that's
 * genuinely still exhausted, immediately falling through exactly as before. */
export function resetProviderFallback(): void {
  stickyProviderIndex = 0;
}

/**
 * Streams one chat completion from one specific provider, invoking
 * `onTextDelta` with the accumulated visible text as tokens arrive (never
 * with reasoning tokens — those are dropped so the model's internal
 * chain-of-thought never leaks into the chat). Tool-call argument
 * fragments are accumulated by index per OpenAI's streaming tool-call
 * format and returned whole at the end, since a tool can only be executed
 * once its full arguments are known. The SSE format is identical across
 * every provider here (all OpenAI-compatible), so only request
 * construction is provider-specific.
 *
 * `forcedToolName`, when given, requires that specific function via
 * `tool_choice` instead of leaving tool use to the model's judgment
 * (`'auto'` normally). Wrapped in a 15s timeout (see REQUEST_TIMEOUT_MS)
 * via AbortController — a request that just hangs (no error, no data)
 * would otherwise never trigger fallback at all, since everything else
 * this file treats as retryable is an explicit error.
 */
async function streamProviderRequest(
  spec: ProviderSpec,
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
  forcedToolName?: string,
): Promise<StreamResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(spec.url, {
      method: 'POST',
      headers: spec.headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: spec.model,
        messages,
        tools: toolDeclarations,
        tool_choice: forcedToolName ? { type: 'function', function: { name: forcedToolName } } : 'auto',
        stream: true,
        ...spec.reasoningParam,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`${spec.name} request failed: ${res.status} ${res.statusText} ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();

  streamLoop: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue; // skip SSE comments/keepalives
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') break streamLoop;

      let chunk: { choices?: { delta?: Record<string, unknown> }[] };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        onTextDelta?.(content);
      }

      const deltaToolCalls = delta.tool_calls as
        | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        | undefined;
      if (Array.isArray(deltaToolCalls)) {
        for (const tc of deltaToolCalls) {
          const idx = tc.index ?? 0;
          const existing = toolCallsByIndex.get(idx) ?? { id: '', name: '', arguments: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallsByIndex.set(idx, existing);
        }
      }
    }
  }

  const toolCalls: ToolCall[] = Array.from(toolCallsByIndex.values())
    .filter((t) => t.name)
    .map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } }));

  return { content, toolCalls, servedBy: spec.name };
}

/**
 * Thin wrapper around streamProviderRequest that makes forcing a tool call
 * best-effort instead of assumed-supported. Found live: forcing
 * `tool_choice` on a provider/model that doesn't support it (OpenRouter's
 * `openai/gpt-oss-20b:free`, confirmed) returns a 400, which
 * isRetryableProviderError correctly does NOT treat as retryable (a 400 is
 * normally a real bug worth surfacing) — so it killed the whole request
 * with no fallback. That's the wrong failure mode for a capability gap
 * that has nothing to do with THIS request being wrong.
 *
 * Two-part fix: skip the cost of finding out twice
 * (providersWithoutForcedToolChoice, checked before ever attempting to
 * force), and handle the first discovery gracefully — catch the specific
 * 400 (isUnsupportedToolChoiceError), remember it for this provider for
 * the rest of the session, and immediately retry the SAME request on the
 * SAME provider with `tool_choice: 'auto'` instead of failing outright.
 * The caller never sees the failed forced attempt at all; from
 * sendAgentMessage's perspective this either returns a normal result or
 * throws for an unrelated reason. If the model doesn't spontaneously call
 * the required tool once forcing is off, that's not a new gap — it's
 * exactly what sendAgentMessage's `guardrail` (fabricated-output
 * detection) already exists to catch on the next round.
 */
async function streamProviderOnce(
  spec: ProviderSpec,
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
  forcedToolName?: string,
): Promise<StreamResult> {
  const effectiveForcedTool = forcedToolName && !providersWithoutForcedToolChoice.has(spec.name) ? forcedToolName : undefined;

  try {
    return await streamProviderRequest(spec, messages, onTextDelta, effectiveForcedTool);
  } catch (err) {
    if (!effectiveForcedTool || !isUnsupportedToolChoiceError(err)) throw err;

    providersWithoutForcedToolChoice.add(spec.name);
    console.warn(
      `[llmProvider] ${spec.name} does not support forced tool_choice (model: ${spec.model}) — remembering that for the rest of this session and retrying the same request with tool_choice: 'auto' instead. The fabricated-output guardrail covers the case where the model doesn't call the tool on its own.`,
      err instanceof Error ? err.message : err,
    );
    return await streamProviderRequest(spec, messages, onTextDelta, undefined);
  }
}

/**
 * Tries each configured provider in fallback order, starting from
 * `stickyProviderIndex`, advancing to the next on any retryable failure —
 * see isRetryableProviderError — including the "empty completion" symptom
 * of a rate limit, checked here so it participates in fallback too (see
 * the comment below). Any other error type surfaces immediately without
 * trying further providers. Logs every attempt to the console (success,
 * retryable failure, or immediate failure), so fallback behavior is
 * visible while testing. Only once every configured provider has failed
 * does this throw — and that final error still carries "rate limit"
 * wording, so the hook's existing isQuotaError check renders the same
 * friendly message it always has.
 */
async function streamChatCompletion(
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
  forcedToolName?: string,
): Promise<StreamResult> {
  const providers = getConfiguredProviders();
  if (providers.length === 0) {
    throw new Error('No LLM provider configured — add at least one API key (see .env.example).');
  }
  if (stickyProviderIndex >= providers.length) stickyProviderIndex = providers.length - 1;

  // When a specific tool MUST be forced this call, don't spend the first
  // attempt on a provider already known (this session) to reject forced
  // tool_choice — streamProviderOnce would just silently drop the force
  // and fall back to 'auto' anyway, so starting there wastes a whole
  // request on a coin-flip instead of going straight to a provider that
  // can actually honor it. Found live: with the sticky provider stuck on
  // one of these, EVERY guardrail-forced retry within a turn kept
  // re-landing on it, silently unforced each time — by the time the
  // 2-retry budget ran out, nothing had ever actually been forced, and an
  // uncorrected reply (missing the swap, missing the price justification)
  // slipped through. Only searches forward from the sticky index, same
  // direction as the fallback loop below — never backward into a provider
  // that was skipped for being rate-limited and likely still is. Doesn't
  // touch stickyProviderIndex itself; a successful call still updates it
  // normally below, same as any other attempt.
  let startIndex = stickyProviderIndex;
  if (forcedToolName) {
    for (let i = stickyProviderIndex; i < providers.length; i += 1) {
      if (!providersWithoutForcedToolChoice.has(providers[i].name)) {
        startIndex = i;
        break;
      }
    }
  }

  let lastError: unknown;
  for (let i = startIndex; i < providers.length; i += 1) {
    const spec = providers[i];
    console.log(`[llmProvider] attempting ${spec.name}${i > 0 ? ' (fallback)' : ''}…`);
    try {
      const result = await streamProviderOnce(spec, messages, onTextDelta, forcedToolName);

      // A completion with no tool calls AND no text is not a valid reply —
      // seen in practice as a stream that returns 200 and a normal-looking
      // SSE sequence, but gets cut off mid-generation by a per-minute
      // token cap before any content token is emitted. Nothing upstream
      // throws for this (the HTTP request genuinely succeeded), so it's
      // treated as a rate-limit symptom and falls through to the next
      // provider exactly like an explicit 429 would.
      if (!result.content.trim() && result.toolCalls.length === 0) {
        throw new Error(`${spec.name} returned an empty completion (rate limit likely truncated the stream mid-generation)`);
      }

      stickyProviderIndex = i;
      console.log(`[llmProvider] request served by ${spec.name}${i > 0 ? ' (fallback)' : ''}`);
      return result;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isRetryableProviderError(err)) {
        console.error(`[llmProvider] ${spec.name} failed with a non-retryable error — not falling back:`, message);
        throw err;
      }
      const next = providers[i + 1];
      const reason =
        err instanceof DOMException && err.name === 'AbortError'
          ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
          : err instanceof TypeError
            ? 'unreachable (network error)'
            : isServerError(message)
              ? 'server error (5xx)'
              : 'rate-limited/quota exceeded';
      console.warn(
        `[llmProvider] ${spec.name} ${reason}${next ? `, falling back to ${next.name}…` : ' — no more providers configured.'}`,
        message,
      );
      stickyProviderIndex = i + 1;
    }
  }

  const triedNames = providers.map((p) => p.name).join(', ');
  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`All configured providers hit their rate limit or quota (tried: ${triedNames}). Last error: ${lastMessage}`);
}

/**
 * Sends a user message, running the function-calling loop until the model
 * returns plain text. `executors` maps tool name -> implementation; each
 * executor is expected to read/mutate app state (which drives the campaign
 * dashboard) and return JSON-serializable data for the model to read back.
 * `onTextDelta` streams the final reply into the UI as it's generated.
 * `contextSummary`, if given, stands in for everything older than the
 * recent-message window sent on the wire — see buildRequestMessages.
 *
 * `guardrail`, if given, is checked against the FIRST text-only (no tool
 * calls) reply the model produces this turn — which is NOT necessarily the
 * very first round. Found live: the model called getCartDetails (a tool
 * call — round 1), then on round 2 just narrated the cart back in plain
 * text instead of ever checking discount eligibility. An earlier version
 * of this function only ever checked round 1 (it unconditionally
 * "disarmed" after the first round regardless of whether that round had
 * tool calls), so a reply shaped exactly like that — one real tool call
 * immediately followed by a reply that skips a required step — sailed
 * straight through uninspected. `guardrail` receives that reply's text and
 * returns the tool name that should have been called before answering, or
 * undefined if the reply is fine as-is (a legitimate reply — including
 * answering an unrelated digression, or correctly finishing the turn after
 * genuinely doing what was required — always returns undefined and is left
 * alone). If it returns a name, this reply is discarded (never shown to
 * the customer, never added to `chat.messages`) and retried with that one
 * tool forced via `tool_choice` for that single request only — up to
 * MAX_GUARDRAIL_RETRIES times per customer message, not just once: found
 * live that a weak enough model can skip two DIFFERENT required steps in
 * sequence (check eligibility, then separately skip generating the code
 * once eligible), and a single retry only ever corrects the first miss.
 * `tool_choice` stays `'auto'` everywhere else, on every other round, on
 * every other provider, so this never costs the model its ability to field
 * a genuine digression. While the guardrail still has retries left,
 * streamed text is buffered instead of forwarded live, so a discarded
 * attempt is never even flashed on screen before the corrected reply
 * replaces it. Every trigger is logged with which provider needed
 * correcting.
 */
/** How many times the guardrail is allowed to reject a reply and force a
 * corrective tool call, per customer message. Found live that this can be
 * a genuine two-step gap on a weak enough model: first attempt skips
 * checkDiscountEligibility entirely (forced), second attempt dutifully
 * checks eligibility but then still skips generateDiscountCode (also
 * forced) — one retry corrected only the first miss and let the second
 * one straight through. Capped, not unbounded, so a model that's
 * persistently wrong doesn't loop forever; the outer round limit (see
 * sendAgentMessage's `guard` loop) is the hard backstop either way. */
const MAX_GUARDRAIL_RETRIES = 2;

export async function sendAgentMessage(
  chat: ChatSession,
  message: string,
  executors: ToolExecutorMap,
  onToolCall?: (name: string, args: Record<string, unknown>, result: unknown) => void,
  onTextDelta?: (textSoFar: string) => void,
  contextSummary?: string,
  guardrail?: (content: string) => string | undefined,
  /**
   * When given, forces this exact tool on the FIRST round of this turn —
   * before the model has said anything at all, not after judging (and
   * possibly misjudging) a reply. This is the proactive counterpart to
   * `guardrail`: the guardrail can only catch a bad reply once one has
   * already been generated, which means its guarantee is only as strong as
   * "the model will eventually get corrected within its retry budget" —
   * not good enough for a rule that has to hold every single time (found
   * live: a price objection with eligibility never checked, requested to
   * be made unconditional rather than best-effort). `initialForcedTool`
   * removes the model's ability to skip the required first step at all,
   * for the one class of case where that's knowable in advance from the
   * customer's message and the facts already on hand — see
   * useCartRecoveryAgent.ts's buildInitialForcedTool.
   */
  initialForcedTool?: string,
): Promise<string> {
  chat.messages.push({ role: 'user', content: message });

  let guard = 0;
  let forcedToolName: string | undefined = initialForcedTool;
  let guardrailRetries = 0;
  // The worst-case legitimate chain now realistically needs more than 6
  // rounds: getCartDetails + checkDiscountEligibility + findSimilarItems
  // (3 tool-call rounds) followed by up to MAX_GUARDRAIL_RETRIES (2)
  // discarded reply attempts, each itself forcing another tool-call round
  // before the NEXT reply attempt is even generated — 8 rounds before the
  // first attempt that's actually still being checked. Found live at 6:
  // a weak fallback provider's 2nd forced retry got discarded right at the
  // round-6 boundary, with no round left to produce the accepted reply —
  // falling through to the generic "having trouble" apology on a cart
  // whose real answer (a single genuine alternative) was one round away.
  while (guard < 9) {
    guard += 1;
    const requestMessages = buildRequestMessages(chat.messages, contextSummary);

    // Buffer streamed text instead of forwarding it live for as long as
    // the guardrail still has retries left — ANY round could turn out to
    // be a reply it rejects, not just the first one (see the doc comment
    // above).
    const buffering = Boolean(guardrail) && guardrailRetries < MAX_GUARDRAIL_RETRIES;
    let buffered = '';
    const deltaSink = buffering
      ? (textSoFar: string) => {
          buffered = textSoFar;
        }
      : onTextDelta;

    const { content, toolCalls, servedBy } = await streamChatCompletion(requestMessages, deltaSink, forcedToolName);
    forcedToolName = undefined; // one-shot — only ever applies to the single request it was set for

    if (toolCalls.length === 0) {
      // A text-only reply is always a candidate final answer — the one
      // point in the loop the guardrail actually has something to judge.
      if (guardrail && guardrailRetries < MAX_GUARDRAIL_RETRIES) {
        const requiredTool = guardrail(content);
        if (requiredTool) {
          guardrailRetries += 1;
          console.warn(
            `[llmProvider] guardrail: ${servedBy} finished the turn without calling ${requiredTool} — discarding and forcing a retry (${guardrailRetries}/${MAX_GUARDRAIL_RETRIES})`,
            { content },
          );
          forcedToolName = requiredTool;
          continue;
        }
      } else if (guardrail && guardrail(content)) {
        // The retry budget is exhausted, but the guardrail STILL flags
        // this reply — found live: a fabricated ₹3,990 price (the real
        // value was ₹4,999) reached the customer on exactly this path,
        // because once guardrailRetries hits MAX_GUARDRAIL_RETRIES the
        // guardrail previously stopped being consulted at all, so
        // whatever the model said next was accepted completely
        // unchecked. A generic apology is strictly safer than showing a
        // reply already known to invent a price, a product, or a link —
        // see buildTurnGuardrail's own doc for why those three checks are
        // unconditional in the first place. Falls through to the same
        // "having trouble" message the outer round-budget exhaustion
        // already uses below, rather than a tool-forced retry (there is
        // no more retry budget left to spend).
        console.warn(
          `[llmProvider] guardrail: ${servedBy} still flagged after ${MAX_GUARDRAIL_RETRIES} corrections — suppressing the reply instead of showing a known-bad one`,
          { content },
        );
        break;
      }
      if (buffering) onTextDelta?.(buffered || content);
      chat.messages.push({ role: 'assistant', content });
      return content;
    }

    chat.messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = {};
      }
      const executor = executors[call.function.name];
      const output = executor ? executor(args) : { error: 'Unknown tool' };
      onToolCall?.(call.function.name, args, output);
      chat.messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(output),
      });
    }
  }

  return "Sorry, I'm having trouble completing that — could you try again?";
}
