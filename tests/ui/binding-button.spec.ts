import { test, expect } from '@playwright/test';

test.describe('Feishu Binding Button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:3000');
    // 等待会话列表加载
    await page.waitForSelector('button:has-text("cp3")');
    // 点击进入会话
    await page.click('button:has-text("cp3")');
    // 等待会话页面加载
    await page.waitForSelector('h2:has-text("hi")');
  });

  test('should display binding button when Feishu is configured', async ({ page }) => {
    // 检查按钮是否存在
    const button = page.locator('button[aria-label="同步到飞书群组"]');
    await expect(button).toBeVisible();
  });

  test('should show tooltip on hover', async ({ page }) => {
    const button = page.locator('button[aria-label="同步到飞书群组"]');

    // 悬停在按钮上
    await button.hover();

    // 检查 tooltip 是否显示
    await expect(page.locator('text=同步到飞书群组')).toBeVisible();
  });

  test('should open dialog when clicked', async ({ page }) => {
    const button = page.locator('button[aria-label="同步到飞书群组"]');

    // 点击按钮
    await button.click();

    // 检查 Dialog 是否打开
    await expect(page.locator('role=dialog[name="同步到飞书"]')).toBeVisible();

    // 检查 Dialog 内容
    await expect(page.locator('h3:has-text("扫码绑定飞书群组")')).toBeVisible();
    await expect(page.locator('text=使用飞书扫码创建群组并绑定此会话')).toBeVisible();
    await expect(page.locator('text=扫码后将自动创建飞书群组，消息将实时同步')).toBeVisible();

    // 检查 QR Code 是否存在
    await expect(page.locator('img[alt="QR Code"]')).toBeVisible();
  });

  test('should close dialog when close button clicked', async ({ page }) => {
    const button = page.locator('button[aria-label="同步到飞书群组"]');

    // 打开 Dialog
    await button.click();
    await expect(page.locator('role=dialog[name="同步到飞书"]')).toBeVisible();

    // 点击关闭按钮
    await page.click('button:has-text("Close")');

    // 检查 Dialog 是否关闭
    await expect(page.locator('role=dialog[name="同步到飞书"]')).not.toBeVisible();
  });

  test('should hide button when Feishu is not configured', async ({ page }) => {
    // Mock API 返回未配置状态
    await page.route('**/api/bridge/config', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ configured: false })
      });
    });

    // 刷新页面
    await page.reload();
    await page.waitForSelector('h2:has-text("hi")');

    // 检查按钮不存在
    const button = page.locator('button[aria-label="同步到飞书群组"]');
    await expect(button).not.toBeVisible();
  });
});
