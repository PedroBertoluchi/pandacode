import { expect, test, type Page } from '@playwright/test';

// ?central seeds three projects (Tibia, BAMemory, Marcalle) beside the leader of ?leadtree. PANDACODE_SHOTS=<dir> saves screenshots.
async function open(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.addInitScript(theme => { localStorage.setItem('pandacode.theme', theme); localStorage.removeItem('pandacode.central'); }, colorScheme);
  await page.goto('/?central');
  await expect(page.locator('.central-entry')).toBeVisible({ timeout: 20_000 });
}
const shot = async (page: Page, name: string) => { if (process.env.PANDACODE_SHOTS) await page.screenshot({ path: process.env.PANDACODE_SHOTS + '/' + name + '.png' }); };

test.describe('Central', () => {
  test.setTimeout(60_000);
  test('the entry sits above the project controls and its badge counts what needs you', async ({ page }) => {
    await open(page);
    const entry = page.locator('.sidebar-central');
    const [entryTop, actionsTop] = await Promise.all([entry.boundingBox(), page.locator('.sidebar-actions').boundingBox()]);
    expect(entryTop!.y).toBeLessThan(actionsTop!.y);
    await expect(page.locator('.central-badge')).toHaveText(/^[1-9]/);
  });

  for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 900], ['dark', 900]] as const) test(`the board has a card per project with counts, a leader and its latest events (${scheme} ${width})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, scheme);
    await page.locator('.central-entry').click();
    const board = page.locator('#central-board');
    await expect(board.locator('.central-card')).toHaveCount(4);
    const bam = board.locator('.central-card', { hasText: 'BAMemory' });
    await expect(bam.locator('.central-count[data-kind=needs] .central-num')).toHaveText('1');
    await expect(bam.locator('.central-count[data-kind=failed] .central-num')).toHaveText('1');
    await expect(bam.locator('.central-event', { hasText: 'Posicionamento needs you' })).toBeVisible();
    await expect(board.locator('.central-card', { hasText: 'Tibia' }).locator('.central-event', { hasText: 'Talentos finished 5 min ago' })).toBeVisible();
    await expect(board.locator('.central-leader .central-progress').first()).toContainText(' of ');
    await expect(board.locator('.central-attention .central-event').first()).toBeVisible();
    await shot(page, `central-${scheme}-${width}`);
    expect(await board.locator('.central-scroll').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test('a click on an event opens that task and leaves the board', async ({ page }) => {
    await open(page);
    await page.locator('.central-entry').click();
    await page.locator('#central-board .central-card', { hasText: 'Tibia' }).locator('.central-event', { hasText: 'Talentos' }).click();
    await expect(page.locator('#central-board')).toBeHidden();
    await expect(page.locator('#transcript')).toBeVisible();
  });

  test('the Settings switch removes the entry and the board', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('pandacode.central', 'false'));
    await page.goto('/?central');
    await expect(page.locator('#navigation')).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('.sidebar-central')).toBeHidden();
    await expect(page.locator('#central-board')).toBeHidden();
  });

  test('asking Central opens its own conversation and keeps it out of the sidebar', async ({ page }) => {
    await open(page);
    await page.locator('.central-entry').click();
    await page.locator('#central-prompt').fill('What needs me today?');
    await page.locator('.central-ask .primary-button').click();
    await expect(page.locator('#central-board')).toBeHidden();
    await expect(page.locator('#navigation .task-item', { hasText: 'Central' })).toHaveCount(0);
  });
});
