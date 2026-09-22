import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 回归测试：卡的 position 必须始终是该列内严格的 0..n-1。
// 曾经的 bug：moveCard 只更新单张卡的 position、不重排整列，同列插入会让两张卡
// 拿到相同的 position；而读取用 orderBy(position asc)，一旦重复排序就不再确定，
// 界面上就表现为"数据混乱"。createCard 还漏了 projectId 过滤，deleteCard 留空洞。
test('同列拖拽插入与删除后，position 始终保持 0..n-1 无重复', async ({ page }) => {
  const tag = Date.now();
  const email = `e2e-pos-${tag}@test.local`;
  const titles = [1, 2, 3, 4].map((i) => `卡${i}-${tag}`);

  page.on('dialog', (d) => d.accept()); // 删除确认用的是原生 confirm

  await page.goto('/register');
  await page.getByPlaceholder('你的名字').fill('位置回归');
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('至少 6 位字符').fill('password123');
  await page.getByRole('button', { name: '注册' }).click();
  await page.waitForURL('**/', { timeout: 20000 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('用户创建失败');
  const proj = await prisma.project.create({ data: { name: '位置项目', userId: user.id } });
  for (let i = 0; i < titles.length; i++) {
    await prisma.card.create({
      data: { title: titles[i], userId: user.id, projectId: proj.id, status: 'todo', position: i },
    });
  }

  // 取该列 position，断言严格为 0..n-1
  const positions = async () => {
    const rows = await prisma.card.findMany({
      where: { userId: user.id, projectId: proj.id, status: 'todo' },
      orderBy: { position: 'asc' },
      select: { position: true },
    });
    return rows.map((r) => r.position);
  };
  const expectStrict = async (n: number) =>
    expect.poll(positions, { timeout: 15000 }).toEqual([...Array(n).keys()]);

  const dragOnto = async (source: string, target: string) => {
    // 删除卡片后页面会刷新，卡片可能短暂消失，必须显式等待可见再取坐标
    // （否则 boundingBox() 返回 null，取 .x 会直接抛错）
    const sourceLoc = page.getByText(source, { exact: true }).first();
    const targetLoc = page.getByText(target, { exact: true }).first();
    await expect(sourceLoc).toBeVisible({ timeout: 15000 });
    await expect(targetLoc).toBeVisible({ timeout: 15000 });
    const sb = (await sourceLoc.boundingBox())!;
    const tb = (await targetLoc.boundingBox())!;
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(150);
    const tx = tb.x + tb.width / 2;
    const ty = tb.y + tb.height / 2;
    for (let i = 1; i <= 25; i++) {
      await page.mouse.move(
        sb.x + sb.width / 2 + (tx - (sb.x + sb.width / 2)) * (i / 25),
        sb.y + sb.height / 2 + (ty - (sb.y + sb.height / 2)) * (i / 25)
      );
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(500);
    await page.mouse.up();
    // 拖拽刚结束时指针状态可能尚未复位，立即点击容易被 dnd-kit 的
    // 拖拽监听吞掉（快照中卡片会停留在 :active），这里留出静置时间
    await page.waitForTimeout(600);
  };

  try {
    await page.goto(`/?project=${proj.id}`);
    await expect(page.getByText(titles[0], { exact: true })).toBeVisible({ timeout: 15000 });
    await expectStrict(4);

    // ① 同列内把最后一张拖到第一张的位置（最容易产生重复的场景）
    await dragOnto(titles[3], titles[0]);
    await expectStrict(4);

    // ② 再来一次
    await dragOnto(titles[1], titles[2]);
    await expectStrict(4);

    // ③ 通过 UI 删除一张，position 应压实为 0..n-2（不留空洞）
    const card4Btn = page.getByRole('button', { name: new RegExp(titles[3]) }).first();
    await expect(card4Btn).toBeVisible({ timeout: 15000 });
    await card4Btn.click();
    const deleteBtn = page.getByRole('button', { name: '删除', exact: true });
    await expect(deleteBtn).toBeVisible({ timeout: 15000 });
    await deleteBtn.click();
    await expectStrict(3);

    // ④ 删除后再同列插入，仍应严格递增
    await dragOnto(titles[1], titles[2]);
    await expectStrict(3);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
