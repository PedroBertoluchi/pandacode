import { expect, test, type Page } from '@playwright/test';

// ?leadtree adds a team leader with six workers (one running pair, one waiting, one queued, one done, one failed)
// and a task with three harness subagents. PANDACODE_SHOTS=<dir> also saves the sidebar for review.
const lead = (page: Page, id: string) => page.locator(`#navigation .lead-tree[data-lead="${id}"]`);

async function open(page: Page, colorScheme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.addInitScript(theme => localStorage.setItem('pandacode.theme', theme), colorScheme);
  await page.goto('/?leadtree');
  await expect(lead(page, 'leadtree-lead').locator('.lead-child')).toHaveCount(6, { timeout: 20_000 });
}

test.describe('leader tree', () => {
  test.setTimeout(60_000);
  test('a leader shows a crown, its progress and every worker under it, coloured by state', async ({ page }) => {
    await open(page);
    const row = page.locator('#navigation .task-row:has(.task-item[data-id="leadtree-lead"])');
    await expect(row.locator('.lead-crown svg')).toBeVisible();
    await expect(row.locator('.lead-progress')).toHaveText('1 of 6');
    const states = await lead(page, 'leadtree-lead').locator('.lead-child').evaluateAll(rows => rows.map(r => (r as HTMLElement).dataset.state));
    expect(states).toEqual(['done', 'failed', 'running', 'waiting', 'queued', 'running']);
    await expect(lead(page, 'leadtree-lead').locator('.lead-limit')).toHaveText('2 of 2 workers running');
    const colour = (state: string) => lead(page, 'leadtree-lead').locator(`.lead-child[data-state="${state}"] .lead-dot`).first().evaluate(dot => getComputedStyle(dot).backgroundColor);
    const colours = await Promise.all(['running', 'waiting', 'done', 'queued', 'failed'].map(colour));
    expect(new Set(colours).size).toBe(5);
  });

  test('only a running child animates its line, and reduced motion holds it still', async ({ page }) => {
    await open(page);
    const path = (state: string) => lead(page, 'leadtree-lead').locator(`.lead-child[data-state="${state}"] .lead-line-in`).first();
    expect(await path('running').evaluate(el => getComputedStyle(el).animationName)).toBe('lead-flow');
    for (const state of ['waiting', 'done', 'queued', 'failed']) expect(await path(state).evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await path('running').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  });

  test('a task with harness subagents gets the same tree, marked as subagents', async ({ page }) => {
    await open(page);
    const tree = lead(page, 'leadtree-agents');
    await expect(tree.locator('.lead-child')).toHaveCount(3);
    await expect(tree.locator('.lead-kind').first()).toHaveAttribute('aria-label', 'subagent');
    await expect(lead(page, 'leadtree-lead').locator('.lead-kind').first()).toHaveAttribute('aria-label', 'worker');
    await expect(tree.locator('.lead-limit')).toHaveText('1 subagent running');
  });

  test('the chevron folds the workers and the choice is remembered', async ({ page }) => {
    await open(page);
    const toggle = page.getByRole('button', { name: /^Hide workers of Leader: SEO/ });
    await toggle.click();
    await expect(lead(page, 'leadtree-lead')).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('button', { name: /^Show workers of Leader: SEO/ })).toBeVisible();
    await expect(lead(page, 'leadtree-lead')).toHaveCount(0);
  });

  test('a child names its model, context and step on hover, and a click opens the worker', async ({ page }) => {
    await open(page);
    const child = lead(page, 'leadtree-lead').locator('.lead-child[data-state="running"]').first();
    await child.hover();
    const tip = page.locator('.tip-bubble.tip-visible');
    await expect(tip).toContainText('Model:');
    await expect(tip).toContainText('Context:');
    await child.click();
    await expect(page.locator('.task-item.selected')).toHaveAttribute('data-id', 'leadtree-lead');
    await expect(page.locator('.architect-panel')).toBeVisible();
  });

  test('keyboard: arrows fold a leader, children are stops with Enter, progress has a name', async ({ page }) => {
    await open(page);
    const row = page.locator('#navigation .task-item[data-id="leadtree-lead"]');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#navigation .task-row:has(.task-item[data-id="leadtree-lead"]) .lead-progress')).toHaveAttribute('role', 'img');
    await row.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(lead(page, 'leadtree-lead')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await row.focus();
    await page.keyboard.press('ArrowDown');
    await expect(lead(page, 'leadtree-lead').locator('.lead-child').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.architect-panel')).toBeVisible();
  });

  test('the title keeps its width: progress sits on the second line and a child shows its context', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 820 });
    await open(page);
    const item = page.locator('#navigation .task-item[data-id="leadtree-lead"]');
    const title = item.locator('.task-title');
    expect((await title.boundingBox())!.width).toBeGreaterThan(90);
    const [progress, name] = await Promise.all([item.locator('.lead-progress').boundingBox(), title.boundingBox()]);
    expect(progress!.y).not.toBeCloseTo(name!.y, -1);
    await expect(lead(page, 'leadtree-lead').locator('.lead-context').first()).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) for (const width of [1280, 900]) {
    test(`screenshot ${scheme} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 820 });
      await open(page, scheme);
      const dir = process.env.PANDACODE_SHOTS;
      if (dir) await page.screenshot({ path: `${dir}/sidebar-tree-${scheme}-${width}.png` });
      await expect(page.locator('#navigation')).toBeVisible();
      expect(await page.locator('#navigation').evaluate(nav => nav.scrollWidth <= nav.clientWidth + 1)).toBe(true);
    });
  }
});
