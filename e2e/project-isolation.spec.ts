import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 回归测试：卡片必须严格隔离在各自项目内。
// 曾经的 bug：看板局部刷新调用的 GET /api/cards 只按 userId 过滤，
// 把该用户所有项目的卡片都返回了；handleRefresh 整体 setCards 之后，
// getCardsByStatus 又只按 status 过滤，于是别的项目的卡片被画到当前看板上。
// 触发路径：新增卡片、删除卡片、增删子任务、发表评论、拖拽失败回滚。
test('卡片不会串到其他项目：新增/子任务/删除后看板只显示当前项目', async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // 删除卡片用的是原生 confirm

  const tag = Date.now();
  const email = `e2e-iso-${tag}@test.local`;

  await page.goto('/register');
  await page.getByPlaceholder('你的名字').fill('隔离回归');
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('至少 6 位字符').fill('password123');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.waitForURL('**/', { timeout: 20000 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('用户创建失败');

  const projA = await prisma.project.create({ data: { name: `项目A-${tag}`, userId: user.id } });
  const projB = await prisma.project.create({ data: { name: `项目B-${tag}`, userId: user.id } });
  await prisma.card.create({
    data: { title: `A-${tag}`, userId: user.id, projectId: projA.id, status: 'todo', position: 0 },
  });
  await prisma.card.create({
    data: { title: `B-${tag}`, userId: user.id, projectId: projB.id, status: 'todo', position: 0 },
  });

  // 看板上出现过的标题（含拖拽层可能产生的重复）
  const boardTitles = async () => {
    const titles = await page.locator('.cursor-pointer h3').allTextContents();
    return [...new Set(titles)];
  };

  try {
    // ── 项目 B ──
    await page.goto(`/?project=${projB.id}`);
    await expect(page.getByText(`B-${tag}`, { exact: true })).toBeVisible({ timeout: 15000 });
    expect(await boardTitles()).toEqual([`B-${tag}`]);

    // ① 在 B 里新增卡片 —— 这条路径以前会把 A 的卡片一起带进来
    await page.locator('.snap-x > div button').first().click();
    await page.getByPlaceholder('输入卡片标题...').fill(`B2-${tag}`);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText(`B2-${tag}`, { exact: true })).toBeVisible({ timeout: 15000 });
    expect(await boardTitles()).toEqual([`B-${tag}`, `B2-${tag}`]);

    // ② 加子任务同样会触发 handleRefresh
    await page.getByText(`B-${tag}`, { exact: true }).first().click();
    await page.getByPlaceholder('添加子任务...').fill(`子任务-${tag}`);
    await page.locator('[role=dialog]').getByRole('button').filter({ has: page.locator('svg.lucide-plus') }).click();
    await page.waitForTimeout(1500);
    await page.locator('[role=dialog]').getByRole('button').filter({ has: page.locator('svg.lucide-x') }).first().click();
    await page.waitForTimeout(1500);
    expect(await boardTitles()).toEqual([`B-${tag}`, `B2-${tag}`]);

    // ③ 删除一张卡（B2），删除后同样会刷新
    await page.getByText(`B2-${tag}`, { exact: true }).first().click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await page.waitForTimeout(2000);
    expect(await boardTitles()).toEqual([`B-${tag}`]);

    // ── 切回项目 A ──
    // 先点开项目切换器，再点目标项目行（切换器按钮显示的是当前项目名）
    await page.getByRole('button', { name: new RegExp(`项目B-${tag}`) }).first().click();
    await page.locator('div.group', { hasText: `项目A-${tag}` }).first().click();
    await page.waitForTimeout(2500);
    expect(await boardTitles()).toEqual([`A-${tag}`]);

    // ④ A 里再新增一张，仍然不能出现 B 的卡片
    await page.locator('.snap-x > div button').first().click();
    await page.getByPlaceholder('输入卡片标题...').fill(`A2-${tag}`);
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByText(`A2-${tag}`, { exact: true })).toBeVisible({ timeout: 15000 });
    expect(await boardTitles()).toEqual([`A-${tag}`, `A2-${tag}`]);

    // ── 接口层面也要守住 ──
    const apiB = await page.evaluate(
      (id) => fetch(`/api/cards?projectId=${id}`).then((r) => r.json()),
      projB.id,
    );
    expect(apiB.map((c: { title: string }) => c.title)).toEqual([`B-${tag}`]);

    // 缺少 projectId 必须被拒绝，防止再被误用
    const noProject = await page.evaluate(() => fetch('/api/cards').then((r) => r.status));
    expect(noProject).toBe(400);

    // 别人的项目拿不到
    const notMine = await page.evaluate(
      (id) => fetch(`/api/cards?projectId=${id}`).then((r) => r.status),
      '00000000-0000-0000-0000-000000000000',
    );
    expect(notMine).toBe(404);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
