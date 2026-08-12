// Screenshots the dashboard in its default (freshly loaded) state — no
// scenario run, no messages sent — so before/after palette comparisons
// aren't confounded by different cart states. Read-only: navigates in an
// isolated Playwright browser context, never touches the dev server or
// any other open tab.
// Usage: node scripts/screenshotDashboard.mjs <out-name> [port]
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const outName = process.argv[2] ?? 'dashboard';
const port = process.argv[3] ?? '5173';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/${outName}-full.png` });

// Also a tighter crop on just the dashboard's right panel (hero stats +
// funnel + secondary stats + table header) for a closer look at the
// accent/ink/paper treatment specifically.
const dashboard = page.locator('text=Cart Recovery Campaign').locator('../..');
await dashboard.screenshot({ path: `${outDir}/${outName}-panel.png` }).catch(async () => {
  await page.screenshot({ path: `${outDir}/${outName}-panel-fallback.png` });
});

await browser.close();
console.log(`Saved ${outName}-full.png (and panel crop) to ${outDir}`);
