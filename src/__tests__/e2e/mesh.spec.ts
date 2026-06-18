import { test, expect } from '@playwright/test'

// 串行：骨架 → 跑一轮(auto，成交) → 指令(改 observe_only)，避免并行抢同一 team config。
test.describe.configure({ mode: 'serial' })

test.describe('mesh 团队驾驶舱', () => {
  test('页面骨架 + 状态条渲染', async ({ page }) => {
    test.setTimeout(120000)
    await page.goto('/mesh')
    await expect(page.getByRole('heading', { name: '炒股 Mesh 团队驾驶舱' })).toBeVisible({ timeout: 60000 })
    await expect(page.getByText('paper 模拟盘')).toBeVisible()
    await expect(page.getByText('live 未接入')).toBeVisible()
    await page.screenshot({ path: 'test-results/mesh-dashboard.png', fullPage: true })
  })

  test('跑一轮 → 真协作 trace/账户渲染', async ({ page }) => {
    test.setTimeout(450000)
    await page.goto('/mesh')
    await page.getByRole('button', { name: '跑一轮' }).click()
    // 真 LLM 串行几分钟，等账户卡渲染出来
    await expect(page.getByText('账户（paper）')).toBeVisible({ timeout: 420000 })
    await expect(page.getByText('盯盘')).toBeVisible()
    await page.screenshot({ path: 'test-results/mesh-run.png', fullPage: true })
  })

  test('发指令 → Leader 应用 → config 渲染', async ({ page }) => {
    test.setTimeout(180000)
    await page.goto('/mesh')
    await page.getByPlaceholder(/只看不买/).fill('只看不买，别碰 600160.SH')
    await page.getByRole('button', { name: '发送指令' }).click()
    await expect(page.getByText('模式→observe_only')).toBeVisible({ timeout: 150000 })
    await page.screenshot({ path: 'test-results/mesh-command.png', fullPage: true })
  })
})
