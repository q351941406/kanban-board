import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** 注册 + 建项目 + 放 3 张卡，返回测试夹具 */
async function setup(page: import('@playwright/test').Page, tag: number) {
  const email = `df-${tag}@test.local`;
  await page.goto('/register');
  await page.getByPlaceholder('你的名字').fill('拖拽反馈');
  await page.getByPlaceholder('your@email.com').fill(email);
  await page.getByPlaceholder('至少 6 位字符').fill('password123');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.waitForURL('**/', { timeout: 25000 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error('用户创建失败');
  const proj = await prisma.project.create({ data: { name: `P-${tag}`, userId: user.id } });
  for (let i = 0; i < 3; i++)
    await prisma.card.create({
      data: { title: `X${i}-${tag}`, userId: user.id, projectId: proj.id, status: 'todo', position: i },
    });

  await page.goto(`/?project=${proj.id}`);
  await expect(page.locator('.cursor-pointer').first()).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(1200);
  return { user, proj };
}

/** 把第 colIdx 列（0=待办 1=进行中 ...）拖到目标列中部 */
async function dragToColumn(page: import('@playwright/test').Page, title: string, colIdx: number) {
  const card = page.locator('.cursor-pointer').filter({ hasText: title }).first();
  const sb = (await card.boundingBox())!;
  const t = await page.evaluate((idx) => {
    const els = [...document.querySelectorAll('.overflow-y-auto')].filter((e) => e.className.includes('space-y-2'));
    const r = els[idx].getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(60, r.height / 2)) };
  }, colIdx);
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(60);
  for (let i = 1; i <= 25; i++) {
    await page.mouse.move(
      sb.x + sb.width / 2 + (t.x - (sb.x + sb.width / 2)) * (i / 25),
      sb.y + sb.height / 2 + (t.y - (sb.y + sb.height / 2)) * (i / 25),
    );
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
}

const toast = (page: import('@playwright/test').Page) => page.locator('[data-testid=app-toast]');

// 回归：拖拽必须给出明确反馈。
// 曾经的 bug：乐观更新只改本地 UI，没有任何提示也不处理失败，
// 用户无法判断是否真的落库，只能刷新页面确认——而刷新会暴露
// 「界面动了但数据没动」的情况，观感就是「刷太快没生效」。
test('拖拽成功后提示「已移动到 X」且数据落库', async ({ page }) => {
  const tag = Date.now();
  const { user } = await setup(page, tag);
  try {
    await dragToColumn(page, `X0-${tag}`, 1);

    await expect(toast(page)).toBeVisible({ timeout: 5000 });
    await expect(toast(page)).toContainText('已移动到「进行中」');

    const db = await prisma.card.findFirst({ where: { title: `X0-${tag}` }, select: { status: true } });
    expect(db?.status).toBe('in_progress');
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});

test('保存失败时提示失败并把卡片还原，不留下「界面动了数据没动」', async ({ page }) => {
  const tag = Date.now();
  const { user } = await setup(page, tag);
  try {
    // 让所有 server action 请求失败，模拟网络/服务端异常
    await page.route('**/*', (route) => {
      const req = route.request();
      if (req.method() === 'POST' && req.headers()['next-action']) return route.abort();
      return route.continue();
    });

    await dragToColumn(page, `X0-${tag}`, 1);

    await expect(toast(page)).toBeVisible({ timeout: 8000 });
    await expect(toast(page)).toContainText('移动失败');

    // 数据确实没变
    const db = await prisma.card.findFirst({ where: { title: `X0-${tag}` }, select: { status: true } });
    expect(db?.status).toBe('todo');

    // 界面也必须回到原位，不能停在「看起来移动了」的假象上
    await expect
      .poll(async () => {
        const inProgress = await page.locator('.overflow-y-auto').evaluateAll((els) => {
          const cols = els.filter((e) => e.className.includes('space-y-2'));
          return cols[1].querySelectorAll('.cursor-pointer').length;
        });
        return inProgress;
      }, { timeout: 8000 })
      .toBe(0);
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
    await prisma.$disconnect();
  }
});
