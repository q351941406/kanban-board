import { test, expect } from '@playwright/test';

test.describe('项目管理：创建 / 重命名 / 删除', () => {
  test('完整流程', async ({ page }) => {
    const email = `e2e-${Date.now()}@test.local`;

    // ── 1. 注册并进入看板 ──
    await page.goto('/register');
    await page.getByPlaceholder('你的名字').fill('E2E 测试');
    await page.getByPlaceholder('your@email.com').fill(email);
    await page.getByPlaceholder('至少 6 位字符').fill('password123');
    await page.getByRole('button', { name: '注册', exact: true }).click();
    await page.waitForURL(/localhost:3000\/$/, { timeout: 20000 });

    // ── 2. 创建项目（下拉在创建后会关闭）──
    await page.getByRole('button', { name: '选择项目' }).click();
    await page.getByRole('button', { name: '新建项目' }).click();
    await page.getByPlaceholder('项目名称').fill('测试项目');
    await page.getByRole('button', { name: '创建' }).click();
    await expect(page.getByRole('button', { name: /测试项目/ }).first()).toBeVisible({ timeout: 15000 });
    console.log('✓ 创建成功');

    // ── 3. 重命名（下拉保持打开）──
    await page.getByRole('button', { name: /测试项目/ }).first().click();
    const row = page.locator('div.group', { hasText: '测试项目' }).first();
    await row.hover();
    await row.getByTitle('重命名项目').click();

    const renameInput = page.locator('input[type="text"]').filter({ hasNot: page.locator('[placeholder]') }).first();
    await expect(renameInput).toHaveValue('测试项目');
    await renameInput.fill('改名后');
    await page.getByTitle('保存').click();
    await expect(page.getByRole('button', { name: /改名后/ }).first()).toBeVisible({ timeout: 15000 });
    console.log('✓ 重命名成功');

    // ── 4. 删除（下拉仍开着，直接操作行）──
    const row2 = page.locator('div.group', { hasText: '改名后' }).first();
    await row2.hover();
    await row2.getByTitle('删除项目').click();
    await expect(page.getByText('删除「')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: '确认删除' }).click();

    // 删除的是当前项目 → 应回落到空态
    await expect(page.getByRole('button', { name: '选择项目' })).toBeVisible({ timeout: 15000 });
    console.log('✓ 删除成功');

    await page.getByRole('button', { name: '选择项目' }).click();
    await expect(page.getByText('还没有项目，创建一个吧')).toBeVisible({ timeout: 10000 });
    console.log('✓ 删空后回到空态');
  });
});
