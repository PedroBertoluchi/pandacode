import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

/* "Open there": the first message of a New task started in a drive root that names another project is held behind a chip. */

test.setTimeout(90_000);

const shots = process.env.PROJECT_HINT_SHOTS;
const chip = (page: Page) => page.locator('#project-hint');

async function newTaskInRoot(page: Page): Promise<void> {
  await newTaskIn(page, 'P:\\');
}
async function newTaskIn(page: Page, name: string): Promise<void> {
  await page.goto('/?projecthint');
  await page.locator('.new-task-button').click();
  await page.locator('#welcome-project').click();
  await page.locator('.project-menu-list').getByText(name, { exact: true }).first().click();
  await expect(page.locator('#welcome-project')).toContainText(name);
}
async function type(page: Page, text: string): Promise<void> {
  await page.locator('#prompt').fill(text);
  await page.locator('#prompt').press('Enter');
}
async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: `${shots}/${name}.png` });
}

test('a prompt naming an unregistered folder asks first, and Open there registers it and sends the message in it', async ({ page }) => {
  await newTaskInRoot(page);
  await type(page, 'Ajusta o outfit do Tibia para o evento');
  await expect(chip(page)).toContainText('Looks like Tibia');
  await expect(chip(page)).toContainText('F:\\Tibia');
  await expect(page.locator('.message.user, .user-message')).toHaveCount(0);
  await chip(page).getByRole('button', { name: 'Open there' }).click();
  await expect(page.locator('#navigation .task-item.selected')).toContainText('Tibia');
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('Ajusta o outfit do Tibia para o evento');
});

test('Keep here sends where the task is, and the chip does not come back', async ({ page }) => {
  await newTaskInRoot(page);
  await type(page, 'Lê as mensagens do Roberto e vê o que devemos');
  await expect(chip(page)).toContainText('Roberto Carlos');
  await chip(page).getByRole('button', { name: 'Keep here' }).click();
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator('#navigation .task-item.selected')).toContainText('P:\\');
  await expect(page.locator('#transcript')).toContainText('Lê as mensagens do Roberto');
});

test('a second send of the same text keeps the task here', async ({ page }) => {
  await newTaskInRoot(page);
  await type(page, 'Corrige o BAMemory');
  await expect(chip(page)).toBeVisible();
  await page.locator('#prompt').press('Enter');
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('Corrige o BAMemory');
});

test('no match sends straight away, and so does the setting turned off', async ({ page }) => {
  await newTaskInRoot(page);
  await type(page, 'Qual a previsão do tempo amanhã?');
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('previsão do tempo');
  await page.evaluate(() => localStorage.setItem('pandacode.projectHint', 'off'));
  await newTaskInRoot(page);
  await type(page, 'Corrige o BAMemory');
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('Corrige o BAMemory');
});

test('a project that is not a drive root or a folder of projects never asks', async ({ page }) => {
  await newTaskIn(page, 'orbit');
  await type(page, 'Corrige o BAMemory');
  await expect(chip(page)).toHaveCount(0);
  await expect(page.locator('#transcript')).toContainText('Corrige o BAMemory');
});

for (const width of [1280, 900]) for (const theme of ['dark', 'light'] as const) {
  test(`proof: the chip at ${width}px, ${theme}`, async ({ page }) => {
    test.skip(!shots, 'PROJECT_HINT_SHOTS names the proof folder');
    await page.setViewportSize({ width, height: 800 });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(value => { localStorage.setItem('pandacode.theme', value); localStorage.setItem('pandacode.wallpapers', 'false'); }, theme);
    await newTaskInRoot(page);
    await type(page, 'Lê as mensagens do Roberto, vê se estamos devendo algo pra ele');
    await expect(chip(page)).toBeVisible();
    const box = (await chip(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, `chip-${width}-${theme}`);
  });
}
