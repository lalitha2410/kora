// Sends a minimal forced-tool_choice request to each configured provider
// and reports whether it's honored or rejected with the 400 this app now
// works around (see llmProvider.ts's streamProviderOnce). Run with:
//   node --env-file=.env scripts/checkToolChoiceSupport.mjs
// Node's fetch has no CORS restriction, so this can even probe SambaNova
// (which the browser app itself can never reach — see llmProvider.ts's
// file-level comment) purely to answer "does the MODEL support this,"
// independent of the browser-only CORS problem.

const TEST_TOOL = {
  type: 'function',
  function: {
    name: 'noop',
    description: 'A no-op test tool.',
    parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
  },
};

const providers = [
  {
    name: 'groq',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-20b',
    key: process.env.VITE_GROQ_API_KEY,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    extra: { reasoning_effort: 'low' },
  },
  {
    name: 'cerebras',
    url: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'gpt-oss-120b',
    key: process.env.VITE_CEREBRAS_API_KEY,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    extra: { reasoning_effort: 'low' },
  },
  {
    name: 'openrouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-oss-20b:free',
    key: process.env.VITE_OPENROUTER_API_KEY,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'tool_choice probe' }),
    extra: { reasoning: { effort: 'low' } },
  },
  {
    name: 'mistral',
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-small-latest',
    key: process.env.VITE_MISTRAL_API_KEY,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    extra: {},
  },
  {
    name: 'sambanova',
    url: 'https://api.sambanova.ai/v1/chat/completions',
    model: 'Meta-Llama-3.3-70B-Instruct',
    key: process.env.VITE_SAMBANOVA_API_KEY,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    extra: {},
  },
];

const results = [];

for (const p of providers) {
  if (!p.key) {
    results.push({ provider: p.name, model: p.model, status: 'SKIPPED (no key configured)' });
    continue;
  }
  try {
    const res = await fetch(p.url, {
      method: 'POST',
      headers: p.headers(p.key),
      body: JSON.stringify({
        model: p.model,
        messages: [{ role: 'user', content: 'Call the noop tool with x="test".' }],
        tools: [TEST_TOOL],
        tool_choice: { type: 'function', function: { name: 'noop' } },
        stream: false,
        ...p.extra,
      }),
    });
    const bodyText = await res.text();
    if (res.ok) {
      let toolCalled = false;
      try {
        const json = JSON.parse(bodyText);
        toolCalled = Boolean(json?.choices?.[0]?.message?.tool_calls?.length);
      } catch {
        // leave toolCalled false
      }
      results.push({
        provider: p.name,
        model: p.model,
        status: `OK (${res.status}) — forced tool_choice honored: ${toolCalled ? 'yes, tool called' : 'request accepted but no tool_calls in response'}`,
      });
    } else {
      const isToolChoiceRejection = res.status === 400 && /tool_choice/i.test(bodyText);
      results.push({
        provider: p.name,
        model: p.model,
        status: isToolChoiceRejection
          ? `REJECTED — ${res.status}: forced tool_choice NOT supported`
          : `ERROR ${res.status} (not a tool_choice rejection) — ${bodyText.slice(0, 200)}`,
      });
    }
  } catch (err) {
    results.push({ provider: p.name, model: p.model, status: `NETWORK ERROR — ${err.message}` });
  }
}

console.log('\ntool_choice: required (forced) support — probed live, one request per configured provider\n');
for (const r of results) {
  console.log(`  ${r.provider.padEnd(12)} ${r.model.padEnd(24)} ${r.status}`);
}
