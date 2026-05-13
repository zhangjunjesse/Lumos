import { test, expect } from '@playwright/test';

test.describe('Ecommerce assistant — 调研 tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/apps/ecommerce-assistant');
  });

  test('tab "调研" sits between "总览" and "选品"', async ({ page }) => {
    const tabs = await page.locator('[role="tab"]').allInnerTexts();
    const overview = tabs.findIndex((t) => t.includes('总览'));
    const research = tabs.findIndex((t) => t.includes('调研'));
    const discover = tabs.findIndex((t) => t.includes('选品'));
    expect(overview).toBeGreaterThanOrEqual(0);
    expect(research).toBeGreaterThan(overview);
    expect(discover).toBeGreaterThan(research);
  });

  test('opens 调研 tab and exposes "新建任务" button + dialog under "调研任务列表"', async ({ page }) => {
    await page.getByRole('tab', { name: '调研', exact: false }).first().click();
    // The 调研任务列表 sub-tab is the default; the form sits behind the 新建任务 button.
    await expect(page.getByRole('tab', { name: /调研任务列表/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^调研报告/ })).toBeVisible();
    await expect(page.getByTestId('new-research-task')).toBeVisible();

    // Click the button — fields should appear inside the dialog.
    await page.getByTestId('new-research-task').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('新建调研任务')).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel(/目标平台/)).toBeVisible();
    await expect(page.getByRole('dialog').getByLabel(/调研指令/)).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: /启动调研/ })).toBeVisible();

    // Cancel closes it.
    await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('clicking a completed task switches to "调研报告" sub-tab with that report preselected', async ({ page, request }) => {
    const created = await request.post('/api/apps/builtin/ecommerce/research', {
      data: { platform: 'etsy', query: '子tab切换测试', instruction: '验证' },
    });
    const { report } = (await created.json()) as { report: { id: string; query: string } };
    // Wait until completed
    await expect.poll(
      async () => {
        const r = await request.get(`/api/apps/builtin/ecommerce/research/${report.id}?body=0`);
        return ((await r.json()) as { report: { status: string } }).report.status;
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    ).toMatch(/completed|failed/);

    // Force a fresh data load so the page's data hook sees the completed status.
    await page.goto('/apps/ecommerce-assistant');
    await page.getByRole('tab', { name: '调研', exact: false }).first().click();

    // The "查看报告" button only appears on COMPLETED tasks — unambiguous click target.
    const viewReportBtn = page.getByRole('button', { name: '查看报告' }).first();
    await expect(viewReportBtn).toBeVisible({ timeout: 15_000 });
    await viewReportBtn.click();

    // Now we should be on the 调研报告 sub-tab and the preview should render.
    await expect(page.getByTestId('research-report-markdown')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /导出 PDF/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /下载 \.md/ })).toBeVisible();

    await request.delete(`/api/apps/builtin/ecommerce/research/${report.id}`);
  });

  test('submits a research task via API and shows it in the list', async ({ page, request }) => {
    // Seed a report directly via API so the test doesn't depend on UI submit
    // (UI submit is exercised separately below) and the report finishes fast.
    const created = await request.post('/api/apps/builtin/ecommerce/research', {
      data: { platform: 'etsy', query: '测试 e2e 报告', instruction: '验证 markdown 渲染' },
    });
    expect(created.ok()).toBeTruthy();
    const { report } = (await created.json()) as { report: { id: string } };

    // Wait for the report to finish before opening it (must be completed for the
    // 调研报告 sub-tab to render the preview).
    await expect.poll(
      async () => {
        const r = await request.get(`/api/apps/builtin/ecommerce/research/${report.id}?body=0`);
        const json = (await r.json()) as { report: { status: string } };
        return json.report.status;
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    ).toMatch(/completed|failed/);

    // Reload to refresh stale React state with the completed status.
    await page.goto('/apps/ecommerce-assistant');
    await page.getByRole('tab', { name: '调研', exact: false }).first().click();
    await expect(page.getByText('测试 e2e 报告').first()).toBeVisible({ timeout: 10_000 });

    // "查看报告" button is the unambiguous nav for completed tasks.
    await page.getByRole('button', { name: '查看报告' }).first().click();

    // Markdown gets rendered into a prose div, h1 derives from the markdown.
    const detailRoot = page.getByTestId('research-report-markdown');
    await expect(detailRoot).toBeVisible({ timeout: 10_000 });
    await expect(detailRoot.locator('h1', { hasText: '调研报告' })).toBeVisible();

    // Toolbar actions on the reports sub-tab (no "报告详情" header anymore)
    await expect(page.getByRole('button', { name: /下载 \.md/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /复制 markdown/ })).toBeEnabled();
    await expect(page.getByRole('button', { name: /导出 PDF/ })).toBeEnabled();

    // Cleanup so the test is rerunnable.
    await request.delete(`/api/apps/builtin/ecommerce/research/${report.id}`);
  });

  test('UI submit (dialog) creates a report end-to-end', async ({ page, request }) => {
    await page.getByRole('tab', { name: '调研' }).click();
    await page.getByTestId('new-research-task').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await dlg.getByLabel(/目标平台/).fill('etsy');
    await dlg.getByLabel(/调研指令/).fill('e2e UI submit smoke');
    await dlg.getByRole('button', { name: /启动调研/ }).click();

    // Dialog should close on successful submit and the row should land in the list.
    await expect(dlg).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('e2e UI submit smoke').first()).toBeVisible({ timeout: 10_000 });

    // Cleanup: find the row we just created and delete via API.
    const list = await request.get('/api/apps/builtin/ecommerce/research?limit=50');
    const { reports } = (await list.json()) as { reports: Array<{ id: string; query: string }> };
    const ours = reports.find((r) => r.query === 'e2e UI submit smoke');
    if (ours) {
      await request.delete(`/api/apps/builtin/ecommerce/research/${ours.id}`);
    }
  });
});
