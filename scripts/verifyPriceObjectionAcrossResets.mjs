// Sends the price-objection message on CART-001, records which tool fired
// FIRST and which provider served the turn, clicks Reset, and repeats —
// three times in ONE browser session (not three fresh page loads), which
// is what actually exercises Reset's behavior rather than just re-testing
// a clean load each time. Usage: node scripts/verifyPriceObjectionAcrossResets.mjs [port]
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const port = process.argv[2] ?? '5173';
const MESSAGE = 'its a bit too expensive';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});

const runs = [];

for (let run = 1; run <= 3; run += 1) {
  const consoleLines = [];
  const listener = (msg) => consoleLines.push(msg.text());
  page.on('console', listener);

  await page.fill('input[placeholder="Type a message"]', MESSAGE);
  await page.click('button[aria-label="Send"]');

  let lastCount = -1;
  let stableTicks = 0;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const typing = await page.locator('[data-typing="true"], [data-streaming="true"]').count();
    const bubbleCount = await page.locator('[data-role]').count();
    if (typing === 0) {
      if (bubbleCount === lastCount) {
        stableTicks += 1;
        if (stableTicks >= 2) break;
      } else {
        stableTicks = 0;
      }
    } else {
      stableTicks = 0;
    }
    lastCount = bubbleCount;
  }

  page.off('console', listener);

  const transcript = await page.locator('[data-role]').allInnerTexts();
  const finalReply = transcript[transcript.length - 1] ?? '(none)';

  const toolCallLines = consoleLines.filter((l) => l.includes('tool call (CART-001)'));
  const firstToolCalled = toolCallLines[0]?.match(/tool call \(CART-001\): (\w+)/)?.[1] ?? '(none)';
  const servedByLines = consoleLines.filter((l) => l.includes('request served by') || l.includes('startup provider check') === false && l.includes('attempting'));
  const guardrailLines = consoleLines.filter((l) => l.includes('guardrail:'));
  const servedBy = consoleLines.filter((l) => l.includes('request served by'));

  runs.push({
    run,
    firstToolCalled,
    allToolCalls: toolCallLines.map((l) => l.match(/tool call \(CART-001\): (\w+)/)?.[1]),
    servedBy,
    guardrailFired: guardrailLines,
    finalReplyMentionsDiscount: /discount|code|off|%/i.test(finalReply),
    finalReply: finalReply.replace(/\n/g, ' | '),
  });

  await page.screenshot({ path: `${outDir}/reset-cycle-run${run}.png` });

  // Reset for the next run — a plain `text=Reset` selector is ambiguous
  // here (TopBar also has a "refresh resets all data" note, which contains
  // "reset" as a substring); scope to the actual <button>.
  await page.click('button:has-text("Reset")');
  await page.waitForTimeout(500);
  const bubblesAfterReset = await page.locator('[data-role]').count();
  if (bubblesAfterReset !== 1) {
    console.error(`  !! Reset did not restore a clean 1-bubble thread — saw ${bubblesAfterReset} bubbles`);
  }
}

console.log(JSON.stringify(runs, null, 2));
await browser.close();
