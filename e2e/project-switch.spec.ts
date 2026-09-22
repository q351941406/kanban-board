import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 回归测试：KanbanBoard 用 useState(initialCards) 保存卡片，仅在首次挂载初始化。
// 若切换项目时不加 key，React 复用组件实例会导致看板一直显示上一个项目的卡片。
test('切换项目时看板卡片应同步刷新', async ({ page }) => {
  const email = `e2e-switch-${Date.now()}@test.local`;

  await page.goto('/register');
  await page.getByPlaceholder('你的名字').fill('切换回归');
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('至少 6 位字符').fill('password123');
  await page.getByRole('button', { name: '注册' }).click();
  await page.waitForURL('**/', { timeout: 20000 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('用户创建失败');

  const pA = await prisma.project.create({ data: { name: '项目A', userId: user.id } });
  const pB = await prisma.project.create({ data: { name: '项目B', userId: user.id } });
  await prisma.card.create({ data: { title: 'A的卡片', userId: user.id, projectId: pA.id, status: 'todo', position: 0 } });
  await prisma.card.create({ data: { title: 'B的卡片', userId: user.id, projectId: pB.id, status: 'todo', position: 0 } });

  try {
    // 直达 A
    await page.goto(`/?project=${pA.id}`);
    await expect(page.getByText('A的卡片')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('B的卡片')).toHaveCount(0);

    // 切到 B
    await page.getByRole('button', { name: /项目A/ }).first().click();
    await page.locator('div.group', { hasText: '项目B' }).first().click();
    await expect(page.getByText('B的卡片')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('A的卡片')).toHaveCount(0);

    // 切回 A
    await page.getByRole('button', { name: /项目B/ }).first().click();
    await page.locator('div.group', { hasText: '项目A' }).first().click();
    await expect(page.getByText('A的卡片')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('B的卡片')).toHaveCount(0);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
