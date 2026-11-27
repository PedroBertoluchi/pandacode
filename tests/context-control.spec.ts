import { expect, test, type Page } from '@playwright/test';

const pill = (page: Page) => page.locator('.composer-context-pill');
const prompt = (page: Page) => page.getByRole('textbox', { name: 'Message your coding agent' });
const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Context' });
const ready = (page: Page) => expect(prompt(page)).toBeEnabled({ timeout: 30_000 });

/** The preview module arrives vite-transformed: double quotes. `edit` rewrites it before the page runs it. */
async function rewritePreview(page: Page, edit: (source: string) => string): Promise<void> {
  await page.route('**/src/preview.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: edit(await response.text()) });
  });
}

test('a warm cache with room says to continue, and the popover lists the four readings', async ({ page }) => {
  await page.goto('/?context=62&cache=120');
  await ready(page);
  await expect(pill(page).locator('.ctx-percent')).toHaveText('62%');
  await expect(pill(page).locator('.ctx-cache')).toHaveText(/^~cache warm [0-4]:\d\d$/);
  await expect(pill(page)).toHaveAttribute('aria-label', /Context: 62% used, ~cache warm, ~\d minutes? left/);
  await pill(page).click();
  const panel = panelOf(page);
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('124K / 200K tokens (62%)');
  await expect(panel.locator('[data-ctx="handoffs"]')).toHaveText(/^\d+$/);
  await expect(panel.locator('[data-ctx="compactions"]')).toHaveText(/^\d+$/);
  await expect(panel.locator('[data-ctx="cache"]')).toHaveText(/^~Warm, [0-4]:\d\d left$/);
  await expect(panel.locator('[data-ctx="note"]')).toContainText('guessed at 5 minutes');
  await expect(panel.getByRole('status')).toContainText('Continue here.');
  const hand = panel.getByRole('button', { name: 'Hand off to new chat' });
  await expect(hand).not.toHaveClass(/ds-btn-primary/);
  await expect(hand).toHaveAttribute('aria-disabled', 'false');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(pill(page)).toBeFocused();
});

test('the hand-off button is aria-disabled true or false, never empty, while stats load and when they fail', async ({ page }) => {
  await rewritePreview(page, source => source.replace('case "task_context_stats": {', 'case "task_context_stats": { if (new URLSearchParams(location.search).has("statsfail")) throw new Error("no stats");'));
  await page.goto('/?context=60&cache=900&statsfail');
  await ready(page);
  await pill(page).click();
  const hand = panelOf(page).getByRole('button', { name: 'Hand off to new chat' });
  await expect(panelOf(page).locator('[data-ctx="handoffs"]')).toHaveText('Unavailable');
  await expect(hand).toHaveAttribute('aria-disabled', 'true');
  await expect(hand).not.toHaveClass(/ds-btn-primary/);
  expect(await hand.getAttribute('aria-disabled')).not.toBe('');
  await hand.click({ force: true });
  await expect(panelOf(page)).toBeVisible();
  await expect(page.getByText('Handed off to a new chat')).toHaveCount(0);
});

test('a cold cache above half the window recommends a new chat; the hand-off carries the messages and counts on the source only', async ({ page }) => {
  await page.goto('/?context=60&cache=900');
  await ready(page);
  await expect(pill(page).locator('.ctx-cache')).toHaveText('~cache cold');
  await pill(page).click();
  const panel = panelOf(page);
  await expect(panel.getByRole('status')).toContainText('Better open a new chat with the recent messages.');
  await expect(panel.getByRole('status')).not.toContainText('summary');
  await expect(panel.getByRole('status')).toContainText('cache is probably cold and context is 60% full');
  const hand = panel.getByRole('button', { name: 'Hand off to new chat' });
  await expect(hand).toHaveClass(/ds-btn-primary/);
  await expect(hand).toHaveAttribute('aria-disabled', 'false');
  await hand.click();
  await expect(page.getByText('Handed off to a new chat with the recent messages').first()).toBeVisible();
  await expect(panel).toBeHidden();
  // The fork starts its own count at zero; the source counts the hand-off.
  await pill(page).click();
  await expect(panelOf(page).locator('[data-ctx="handoffs"]')).toHaveText('0');
  await page.keyboard.press('Escape');
  await page.locator('#navigation .task-item', { hasText: 'Make search feel instant' }).filter({ hasNotText: '(fork)' }).first().click();
  await expect(pill(page)).toBeVisible();
  await pill(page).click();
  await expect(panelOf(page).locator('[data-ctx="handoffs"]')).toHaveText('1');
});

test('above 70% a warm cache still recommends a new chat, and the pill stays inside the tray at every width', async ({ page }) => {
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?context=85&cache=30');
    await ready(page);
    const box = await pill(page).boundingBox();
    const tray = await page.locator('.composer-tray').boundingBox();
    expect(box && tray && box.x >= tray.x && box.x + box.width <= tray.x + tray.width + 1, `pill inside the tray at ${width}`).toBe(true);
    expect(box!.height).toBeLessThanOrEqual(31);
  }
  await pill(page).click();
  await expect(panelOf(page).getByRole('status')).toContainText('Context is 85% full');
});

test('what sits right of the pill does not move between readings, warm and cold', async ({ page }) => {
  const nextX = () => pill(page).evaluate(el => el.nextElementSibling ? Math.round(el.nextElementSibling.getBoundingClientRect().x) : -1);
  const seen: number[] = [];
  for (const url of ['/', '/?context=5&cache=10', '/?context=62&cache=100', '/?context=100&cache=900', '/?context=62&cache=299']) {
    await page.goto(url);
    await ready(page);
    await expect(pill(page)).toBeVisible();
    seen.push(await nextX());
  }
  expect(seen.every(x => x > 0), `a neighbour exists: ${seen}`).toBe(true);
  expect(new Set(seen).size, `neighbour x across states: ${seen}`).toBe(1);
});

test('a harness with no known cache shows the window alone', async ({ page }) => {
  await rewritePreview(page, source => source.replace('title: "Make search feel instant", provider: "claude"', 'title: "Make search feel instant", provider: "codex"'));
  await page.goto('/?context=75&cache=10');
  await ready(page);
  await expect(pill(page).locator('.ctx-percent')).toHaveText('75%');
  await expect(pill(page).locator('.ctx-cache')).toHaveCount(0);
  await expect(pill(page)).toHaveAttribute('aria-label', 'Context: 75% used');
  await pill(page).click();
  await expect(panelOf(page).locator('[data-ctx="cache"]')).toHaveText('Not tracked for this harness');
  await expect(panelOf(page).getByRole('status')).toContainText('Context is 75% full');
});

test('the clock runs only while a visible pill counts a warm cache down', async ({ page }) => {
  await page.addInitScript(() => {
    const active = new Set<number>(), set = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
    (window as any).__second = () => active.size;
    window.setInterval = ((handler: TimerHandler, delay?: number, ...rest: unknown[]) => { const id = set(handler, delay, ...rest); if (delay === 1000) active.add(id); return id; }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { if (id !== undefined) active.delete(id); clear(id); }) as typeof window.clearInterval;
  });
  const seconds = () => page.evaluate(() => (window as any).__second() as number);
  await page.goto('/?context=62&cache=900');
  await ready(page);
  await expect(pill(page)).toBeVisible();
  await page.waitForTimeout(500);
  const cold = await seconds();
  await page.goto('/?context=62&cache=100');
  await ready(page);
  await expect(pill(page)).toBeVisible();
  await expect.poll(seconds).toBeGreaterThan(cold);
  const text = await pill(page).locator('.ctx-cache').textContent();
  await expect.poll(() => pill(page).locator('.ctx-cache').textContent()).not.toBe(text);
});
