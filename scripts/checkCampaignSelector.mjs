// Ad-hoc check: click through each campaign-type tab and screenshot the
// dashboard panel, to visually confirm the selector/funnel/revenue-by-type
// view/table all re-render correctly for each scope.
import { chromium } from 'playwright';

const outDir = String.raw`C:\Users\kamal\AppData\Local\Temp\claude\c--Users-kamal-Desktop-react-projects-CartRecovery\706691fd-341c-42e8-a9a7-bf222be9c4a6\scratchpad`;
const port = process.argv[2] ?? '5176';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (err) => errors.push(err.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
await page.click('text=Got it').catch(() => {});
await page.waitForTimeout(400);

const tabs = ['All campaigns', 'Cart Recovery', 'Recommendations', 'Browse Abandonment'];
for (const tab of tabs) {
  await page.click(`button:has-text("${tab}")`);
  await page.waitForTimeout(300);
  const dashboard = page.locator('text=Cart Recovery Campaign').locator('../..');
  await dashboard.screenshot({ path: `${outDir}/selector-${tab.replace(/\s+/g, '_')}.png` });
  const rowCount = await page.locator('[data-testid="cart-row"]').count();
  console.log(`${tab}: ${rowCount} rows shown`);
}

console.log('--- console/page errors ---');
for (const e of errors) console.log(e);
console.log(errors.length === 0 ? 'NO ERRORS' : `${errors.length} ERROR(S)`);

await browser.close();
