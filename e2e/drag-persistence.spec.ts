import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 回归测试：拖拽必须真正持久化。
// 曾经的 bug：handleDragEnd 依赖 setState 回调里的赋值（React 会延迟执行，
// 读到空值提前 return），且 over 常等于 active 自身（useSortable 让卡片也是
// droppable），被 `activeId === overId` 守卫拦住 —— 两个原因都导致 moveCard
// 从未被调用，UI 只是靠 handleDragOver 的乐观更新假装移动了。
test('拖动卡片到其他列后应持久化，切换项目再回来位置保持', async ({ page }) => {
  const email = `e2e-drag-${Date.now()}@test.local`;

  await page.goto('/register');
  await page.getByPlaceholder('你的名字').fill('拖拽回归');
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('至少 6 位字符').fill('password123');
  await page.getByRole('button', { name: '注册' }).click();
  await page.waitForURL('**/', { timeout: 20000 });

  const cardTitle = `卡片-${Date.now()}`;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('用户创建失败');

  const projB = await prisma.project.create({ data: { name: '另一个项目', userId: user.id } });
  const proj = await prisma.project.create({ data: { name: '拖拽项目', userId: user.id } });
  const card = await prisma.card.create({
    data: { title: cardTitle, userId: user.id, projectId: proj.id, status: 'todo', position: 0 },
  });

  try {
    await page.goto(`/?project=${proj.id}`);
    await expect(page.getByText(cardTitle, { exact: true })).toBeVisible({ timeout: 15000 });

    // 记录卡片所在列（与各列标题水平距离最近者）
    const columnOf = async () => {
      const cb = await page.getByText(cardTitle, { exact: true }).first().boundingBox();
      if (!cb) return null;
      const cols: { name: string; x: number }[] = [];
      for (const name of ['待办', '进行中', '测试中', '已完成']) {
        const bb = await page.getByText(name, { exact: true }).first().boundingBox().catch(() => null);
        if (bb) cols.push({ name, x: bb.x });
      }
      cols.sort((a, b) => Math.abs(a.x - cb.x) - Math.abs(b.x - cb.x));
      return cols[0]?.name ?? null;
    };

    await expect.poll(columnOf, { timeout: 10000 }).toBe('待办');

    // 拖到「进行中」
    const cb = (await page.getByText(cardTitle, { exact: true }).first().boundingBox())!;
    const tb = (await page.getByText('进行中', { exact: true }).first().boundingBox())!;
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const tx = tb.x + 120;
    const ty = tb.y + 250;
    for (let i = 1; i <= 25; i++) {
      await page.mouse.move(
        cb.x + cb.width / 2 + (tx - (cb.x + cb.width / 2)) * (i / 25),
        cb.y + cb.height / 2 + (ty - (cb.y + cb.height / 2)) * (i / 25)
      );
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(500);
    await page.mouse.up();

    // 断言 1：数据库已持久化
    await expect
      .poll(async () => (await prisma.card.findUnique({ where: { id: card.id } }))?.status, {
        timeout: 15000,
      })
      .toBe('in_progress');

    // 断言 2：UI 上已到「进行中」
    await expect.poll(columnOf, { timeout: 10000 }).toBe('进行中');

    // 断言 3：切换项目再切回，位置保持
    await page.goto(`/?project=${projB.id}`);
    await page.waitForTimeout(800);
    await page.goto(`/?project=${proj.id}`);
    await expect(page.getByText(cardTitle, { exact: true })).toBeVisible({ timeout: 15000 });
    await expect.poll(columnOf, { timeout: 10000 }).toBe('进行中');
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
