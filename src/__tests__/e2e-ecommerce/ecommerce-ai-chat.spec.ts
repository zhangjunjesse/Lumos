import { test, expect } from '@playwright/test';

test.describe('Ecommerce assistant app — AI chat panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/ecommerce-assistant');
  });

  test('renders the four-tab layout', async ({ page }) => {
    await expect(page.getByRole('tab', { name: '工坊' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '任务' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '资料库' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '预设' })).toBeVisible();
  });

  test('bottom chat panel mounts and exposes a textarea', async ({ page }) => {
    // The chat panel starts collapsed, but ChatView's textarea is rendered eagerly.
    await page.waitForSelector('textarea', { timeout: 15_000 });
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
  });

  test('lumos:chat-draft event populates the chat input (used by 问 AI buttons)', async ({ page }) => {
    await page.waitForSelector('textarea', { timeout: 15_000 });
    const textarea = page.locator('textarea').first();

    const sample = '测试电商对话框：请告诉我从 0 到 1 的步骤';
    await page.evaluate((text) => {
      window.dispatchEvent(
        new CustomEvent('lumos:chat-draft', { detail: { text, mode: 'replace' } }),
      );
    }, sample);

    // PromptInputTextarea is a controlled input; React will commit the value on the next render.
    await expect(textarea).toHaveValue(sample, { timeout: 5_000 });
  });

  test('lumos:chat-expand event flips the panel from collapsed to expanded', async ({ page }) => {
    await page.waitForSelector('textarea', { timeout: 15_000 });

    // Snapshot the collapsed-state outerHTML of the chat panel container so we can compare.
    // BottomChatPanel adds `rounded-2xl border border-border/70 bg-background shadow-sm`
    // only when expanded. We detect that border class presence.
    await expect.poll(async () => {
      return await page.evaluate(() => {
        return document.body.innerHTML.includes('rounded-2xl border border-border/70');
      });
    }).toBe(false);

    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('lumos:chat-expand'));
    });

    await expect.poll(async () => {
      return await page.evaluate(() => {
        return document.body.innerHTML.includes('rounded-2xl border border-border/70');
      });
    }, { timeout: 3_000 }).toBe(true);
  });

  test('Studio tab "问 AI 怎么开始" button (when empty state visible) dispatches both events', async ({ page }) => {
    // Listen for the dispatched events from the button click.
    const events: string[] = [];
    await page.exposeFunction('__recordEcommerceEvent', (type: string) => {
      events.push(type);
    });
    await page.evaluate(() => {
      window.addEventListener('lumos:chat-expand', () => {
        (window as unknown as { __recordEcommerceEvent: (t: string) => void }).__recordEcommerceEvent('lumos:chat-expand');
      });
      window.addEventListener('lumos:chat-draft', () => {
        (window as unknown as { __recordEcommerceEvent: (t: string) => void }).__recordEcommerceEvent('lumos:chat-draft');
      });
    });

    const askButton = page.getByRole('button', { name: '问 AI 怎么开始' });
    const visible = await askButton.isVisible().catch(() => false);

    if (!visible) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'StudioTab empty state not visible (product inputs already exist) — empty-state CTA is conditional.',
      });
      test.skip();
      return;
    }

    await askButton.click();

    await expect.poll(() => events).toEqual(['lumos:chat-expand', 'lumos:chat-draft']);

    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue(/get_ecommerce_status/, { timeout: 3_000 });
  });
});
