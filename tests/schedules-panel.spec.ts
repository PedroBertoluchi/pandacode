import { expect, test, type Page } from '@playwright/test';

const WINDOWS_FILE = 'C:/schedules/windows-tasks.json';
const WINDOWS_REPORT = {
  configured: true,
  generated: '2026-11-26T15:46:10',
  warning: null,
  tasks: [
    { name: 'AudioGuard', does: 'Checks the headset audio at 03:30.', ai: 'script', mark: '', when: 'every day 03:30', next: '2026-11-27 03:30', last: '2026-11-26 03:30', result: 'ok', command: 'pwsh.exe -File audio-guard.ps1' },
    { name: 'Nightly import', does: 'Opens an AI session to triage the import.', ai: 'abre IA', mark: '', when: 'every day 02:00', next: '2026-11-27 02:00', last: '2026-11-26 02:00', result: 'erro 1', command: 'claude.exe -p triage' },
    { name: 'Old cleanup', does: 'Removes old caches.', ai: 'script', mark: 'quebrado', when: 'on login', next: '', last: '2026-11-20 08:00', result: 'ok', command: 'cleanup.cmd' },
    { name: 'Paused sync', does: 'Syncs a folder.', ai: 'IA só com novidade', mark: 'desligada', when: 'every 5 min', next: '', last: '2026-11-19 10:00', result: 'ok', command: 'sync.cmd' },
  ],
};

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Message your coding agent', exact: true });
const trigger = (page: Page) => page.locator('.schedules-trigger');
const hover = (page: Page) => page.locator('#schedules-hover');
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Schedules', exact: true });
const invoke = (page: Page, command: string, args: Record<string, unknown>) => page.evaluate(async ([command, args]) => {
  const { invoke } = await import((window as any).__pandacodePreviewUrl ?? '/src/preview.ts');
  return invoke(command, args);
}, [command, args] as const);

async function open(page: Page, windows = false): Promise<void> {
  if (windows) await page.addInitScript(report => { (window as any).__windowsSchedules = report; }, WINDOWS_REPORT);
  await page.goto('/');
  await expect(prompt(page)).toBeEnabled();
}

async function saveWindowsPath(page: Page, path: string): Promise<void> {
  const settings = await invoke(page, 'scheduler_settings', {}) as Record<string, unknown>;
  await invoke(page, 'scheduler_set_settings', { settings: { ...settings, windowsSchedulesPath: path } });
}

test('hovering Schedules lists the next runs of every project, soonest first, with the last result', async ({ page }) => {
  await open(page);
  await expect(hover(page)).toHaveCount(0);
  await trigger(page).hover();
  await expect(hover(page)).toBeVisible();
  const rows = hover(page).locator('.sh-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Check the CI run');
  await expect(rows.nth(0)).toContainText('Once');
  await expect(rows.nth(0)).toContainText('Not run yet');
  await expect(rows.nth(1)).toContainText('Daily check');
  await expect(rows.nth(1)).toContainText('Daily at');
  await expect(rows.nth(1)).toContainText('OK');
  await expect(rows.nth(2)).toContainText('Morning summary');
  await expect(rows.nth(2)).toContainText('Weekdays at');
  await expect(rows.nth(2)).toContainText(/Today|Tomorrow|Mon|Tue|Wed|Thu|Fri/);
  await expect(hover(page)).not.toContainText('Review after build');
  await page.mouse.move(700, 500);
  await expect(hover(page)).toHaveCount(0);
});

test('the hover shows an error as the last result and says so when nothing is scheduled', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { (window as any).__schedules = []; });
  await page.reload();
  await expect(prompt(page)).toBeEnabled();
  await trigger(page).hover();
  await expect(hover(page)).toContainText('Nothing is scheduled to run.');
});

test('clicking Schedules opens the panel with every PandaCode schedule, switched-on first', async ({ page }) => {
  await open(page);
  await trigger(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole('tab', { name: 'Windows' })).toHaveCount(0);
  const rows = dialog(page).locator('.sp-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText('Check the CI run');
  await expect(rows.last()).toContainText('Review after build');
  await expect(rows.last()).toHaveAttribute('data-enabled', 'true');
  const toggle = dialog(page).getByRole('switch', { name: 'Check the CI run' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  const off = dialog(page).locator('.sp-row', { hasText: 'Check the CI run' });
  await expect(off).toHaveAttribute('data-enabled', 'false');
  await expect(dialog(page).locator('.sp-row').last()).toContainText('Check the CI run');
  await dialog(page).getByRole('switch', { name: 'Check the CI run' }).click();
  await expect(dialog(page).locator('.sp-row', { hasText: 'Check the CI run' })).toHaveAttribute('data-enabled', 'true');
});

test('the panel opens the last task a schedule created and the schedule settings', async ({ page }) => {
  await open(page);
  await trigger(page).click();
  const daily = dialog(page).locator('.sp-row', { hasText: 'Daily check' });
  await expect(daily.getByRole('button', { name: 'Open last task' })).toBeVisible();
  await expect(dialog(page).locator('.sp-row', { hasText: 'Morning summary' }).getByRole('button', { name: 'Open task', exact: true })).toBeVisible();
  await daily.getByRole('button', { name: 'Open last task' }).click();
  await expect(dialog(page)).toBeHidden();
  await trigger(page).click();
  await dialog(page).getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.getByRole('region', { name: 'Settings', exact: true }).getByRole('heading', { name: 'Upcoming', exact: true })).toBeVisible();
});

test('the Windows tab appears once a file is saved and lists the tasks read only', async ({ page }) => {
  await open(page, true);
  await saveWindowsPath(page, WINDOWS_FILE);
  await trigger(page).click();
  const tabs = dialog(page).getByRole('tablist', { name: 'Schedule sources' });
  await expect(tabs.getByRole('tab', { name: 'PandaCode' })).toHaveAttribute('aria-selected', 'true');
  await tabs.getByRole('tab', { name: 'Windows' }).click();
  await expect(tabs.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true');
  const rows = dialog(page).locator('.sp-windows-row');
  await expect(rows).toHaveCount(4);
  const audio = rows.filter({ hasText: 'AudioGuard' });
  await expect(audio).toContainText('Checks the headset audio at 03:30.');
  await expect(audio).toContainText('script');
  await expect(audio).toContainText('every day 03:30');
  await expect(audio).toContainText('Next: 2026-11-27 03:30');
  await expect(audio.locator('.sp-result')).toHaveText('ok');
  await expect(audio).toHaveAttribute('data-tone', 'ok');
  await expect(audio.locator('.sp-name')).toHaveAttribute('data-tip', 'pwsh.exe -File audio-guard.ps1');
  const failed = rows.filter({ hasText: 'Nightly import' });
  await expect(failed).toHaveAttribute('data-tone', 'error');
  await expect(failed.locator('.sp-result')).toHaveText('erro 1');
  await expect(failed.locator('.sp-ai')).toHaveText('abre IA');
  await expect(rows.filter({ hasText: 'Old cleanup' })).toHaveAttribute('data-tone', 'error');
  await expect(rows.filter({ hasText: 'Old cleanup' }).locator('.sp-tag[data-mark]')).toHaveText('quebrado');
  await expect(rows.filter({ hasText: 'Paused sync' })).toHaveAttribute('data-tone', 'off');
  await expect(dialog(page).locator('.sp-windows-row :is(input, button)')).toHaveCount(0);
  await expect(dialog(page).locator('.sp-note')).toContainText('Generated 2026-11-26 15:46');
});

test('a missing or invalid Windows file shows a notice and the app keeps working', async ({ page }) => {
  await open(page);
  await saveWindowsPath(page, 'C:/schedules/absent.json');
  await trigger(page).click();
  await dialog(page).getByRole('tab', { name: 'Windows' }).click();
  await expect(dialog(page).getByRole('alert').filter({ hasText: 'not found' })).toBeVisible();
  await expect(dialog(page).locator('.sp-windows-row')).toHaveCount(0);
  await dialog(page).getByRole('tab', { name: 'PandaCode' }).click();
  await expect(dialog(page).locator('.sp-row')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { (window as any).__windowsSchedules = { configured: true, generated: '', tasks: [], warning: 'The Windows schedules file is not valid: expected value at line 1 column 2' }; });
  await trigger(page).click();
  await dialog(page).getByRole('tab', { name: 'Windows' }).click();
  await expect(dialog(page).getByRole('alert').filter({ hasText: 'not valid' })).toBeVisible();
  await expect(prompt(page)).toBeEnabled();
});

test('the path is saved in Settings, an empty path hides the Windows tab', async ({ page }) => {
  await open(page, true);
  await page.keyboard.press('Meta+,');
  const settings = page.getByRole('region', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: 'Schedules', exact: true }).click();
  const field = settings.getByRole('textbox', { name: 'Windows schedules file', exact: true });
  await expect(field).toHaveValue('');
  await field.fill(WINDOWS_FILE);
  await field.press('Tab');
  await expect.poll(async () => (await invoke(page, 'scheduler_settings', {}) as { windowsSchedulesPath: string }).windowsSchedulesPath).toBe(WINDOWS_FILE);
  await field.fill('');
  await field.press('Tab');
  await expect.poll(async () => (await invoke(page, 'scheduler_settings', {}) as { windowsSchedulesPath: string }).windowsSchedulesPath).toBe('');
});
