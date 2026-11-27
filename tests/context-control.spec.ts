import { expect, test } from '@playwright/test';

const pill = (page: import('@playwright/test').Page) => page.locator('.composer-context-pill');
const prompt = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Message your coding agent' });

test('a warm cache with room says to continue, and the popover lists the four readings', async ({ page }) => {
  await page.goto('/?context=62&cache=120');
  await expect(prompt(page)).toBeEnabled({ timeout: 30_000 });
  await expect(pill(page).locator('.ctx-percent')).toHaveText('62%');
  await expect(pill(page).locator('.ctx-cache')).toHaveText(/^cache warm [0-3]:\d\d$/);
  await expect(pill(page)).toHaveAttribute('aria-label', /Context: 62% used, cache warm, about \d minutes? left/);
  await pill(page).click();
  const panel = page.getByRole('dialog', { name: 'Context' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('124K / 200K tokens (62%)');
  await expect(panel.locator('[data-ctx="handoffs"]')).toHaveText(/^\d+$/);
  await expect(panel.locator('[data-ctx="compactions"]')).toHaveText(/^\d+$/);
  await expect(panel.locator('[data-ctx="cache"]')).toHaveText(/^Warm, [0-3]:\d\d left$/);
  await expect(panel.getByRole('status')).toContainText('Continue here.');
  await expect(panel.getByRole('button', { name: 'Hand off to new chat' })).not.toHaveClass(/ds-btn-primary/);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(pill(page)).toBeFocused();
});

test('a cold cache above half the window recommends a new chat and the button forks with the content', async ({ page }) => {
  await page.goto('/?context=60&cache=900');
  await expect(prompt(page)).toBeEnabled({ timeout: 30_000 });
  await expect(pill(page).locator('.ctx-cache')).toHaveText('cache cold');
  await pill(page).click();
  const panel = page.getByRole('dialog', { name: 'Context' });
  await expect(panel.getByRole('status')).toContainText('Better open a new chat with a summary.');
  await expect(panel.getByRole('status')).toContainText('cache is cold and context is 60% full');
  const hand = panel.getByRole('button', { name: 'Hand off to new chat' });
  await expect(hand).toHaveClass(/ds-btn-primary/);
  await expect(hand).not.toHaveAttribute('aria-disabled', 'true');
  await hand.click();
  await expect(page.getByText('Conversation forked').first()).toBeVisible();
  await expect(panel).toBeHidden();
});

test('above 70% a warm cache still recommends a new chat, and the pill stays one line and inside the composer', async ({ page }) => {
  for (const width of [1280, 900, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/?context=85&cache=30');
    await expect(prompt(page)).toBeEnabled({ timeout: 30_000 });
    const box = await pill(page).boundingBox();
    const tray = await page.locator('.composer-tray').boundingBox();
    expect(box && tray && box.x >= tray.x && box.x + box.width <= tray.x + tray.width + 1, `pill inside the tray at ${width}`).toBe(true);
    expect(box!.height).toBeLessThanOrEqual(31);
  }
  await pill(page).click();
  await expect(page.getByRole('dialog', { name: 'Context' }).getByRole('status')).toContainText('Context is 85% full');
});
