import { test, expect, devices, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

/**
 * 移动端「底部抽屉 + 编辑」的回归测试。
 *
 * 真机上踩过、桌面模拟器一个都复现不出来的坑：
 *  1. 输入框字号 < 16px → iOS Safari 聚焦时自动放大页面（≈1.14x）且不还原，
 *     页面停在放大/平移状态，面板看起来「跑到屏幕右边外面」——这就是「一编辑 UI 就坏」。
 *  2. 软键盘弹起时 iOS 不移动 position:fixed，而是缩小并平移「可视视口」；
 *     面板按布局视口定位会被顶出屏幕，再叠加一次键盘高度（marginBottom）会被压扁。
 *  3. 可视视口横向平移（缩放后拖动）时，面板必须跟着走，否则右侧按钮点不到。
 *
 * Chromium 没有真键盘，这里用桩替换 window.visualViewport，
 * 模拟「布局视口不动、可视视口被键盘吃掉下半屏」——与 iOS 的行为一致。
 */
async function installFakeViewport(page: Page) {
  await page.addInitScript(() => {
    // 注意：init script 执行时设备视口可能还没应用（会拿到 980 宽的默认值），
    // 所以初始值要惰性读 window.innerWidth/innerHeight。
    const state = {
      width: null as number | null,
      height: null as number | null,
      offsetTop: 0,
      offsetLeft: 0,
    };
    const bus = new EventTarget();
    const stub = {
      get width() { return state.width ?? window.innerWidth; },
      get height() { return state.height ?? window.innerHeight; },
      get offsetTop() { return state.offsetTop; },
      get offsetLeft() { return state.offsetLeft; },
      get scale() { return 1; },
      get pageTop() { return state.offsetTop; },
      get pageLeft() { return state.offsetLeft; },
      addEventListener: bus.addEventListener.bind(bus),
      removeEventListener: bus.removeEventListener.bind(bus),
      dispatchEvent: bus.dispatchEvent.bind(bus),
    };
    Object.defineProperty(window, 'visualViewport', { value: stub, configurable: true });
    const set = (patch: Partial<typeof state>) => {
      Object.assign(state, patch);
      bus.dispatchEvent(new Event('resize'));
      bus.dispatchEvent(new Event('scroll'));
    };
    (window as unknown as Record<string, unknown>).__vv = {
      /** 模拟软键盘：布局视口不变，可视视口变矮（可选上移量） */
      keyboard: (height: number, offsetTop = 0) => set({ height, offsetTop }),
      /** 模拟 Safari 把可视视口横向/纵向平移（缩放后拖动页面） */
      pan: (offsetLeft: number, offsetTop: number) => set({ offsetLeft, offsetTop }),
    };
  });
}

async function setVp(page: Page, kind: 'keyboard' | 'pan', a: number, b = 0) {
  await page.evaluate(
    ([k, x, y]) => {
      const vv = (window as unknown as Record<string, { keyboard: (h: number, t: number) => void; pan: (l: number, t: number) => void }>).__vv;
      if (k === 'keyboard') vv.keyboard(x, y);
      else vv.pan(x, y);
    },
    [kind, a, b] as [string, number, number],
  );
  await page.waitForTimeout(450);
}

async function geometry(page: Page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const panel = [...dialog.children].find((c) =>
      (c as HTMLElement).className.includes('relative'),
    ) as HTMLElement;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const vv = window.visualViewport!;
    return {
      layoutWidth: window.innerWidth,
      visibleWidth: vv.width,
      visibleHeight: vv.height,
      visibleTop: vv.offsetTop,
      visibleLeft: vv.offsetLeft,
      overlay: box(dialog),
      panel: box(panel),
      fontSizes: [...panel.querySelectorAll('input, textarea')].map(
        (el) => parseFloat(getComputedStyle(el).fontSize),
      ),
      docScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

// 注意：含 defaultBrowserType 的 test.use 不能放在 describe 里（会强制换 worker）
test.use({ ...devices['Pixel 7'], hasTouch: true, isMobile: true });

/**
 * 打开面板。dev 下首屏可能还没 hydration，点按钮等于点空气，
 * 所以这里「点 → 断言」重试若干轮，而不是死等一个必然失败的断言。
 */
async function openSheet(page: Page, name: string, opener: () => Promise<unknown>) {
  const dialog = page.getByRole('dialog', { name });
  for (let i = 0; i < 25; i++) {
    await opener().catch(() => {});
    if (await dialog.isVisible().catch(() => false)) {
      await page.waitForTimeout(400);
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`面板未打开：${name}`);
}

const openAddSheet = (page: Page) =>
  openSheet(page, '新建卡片', () =>
    page.locator('div.rounded-t-2xl button').first().click({ force: true }),
  );

const openCardSheet = (page: Page, title: string) =>
  openSheet(page, '卡片详情', () =>
    page.getByText(title, { exact: true }).first().click({ force: true }),
  );



test.describe('移动端底部抽屉', () => {
  const createdEmails: string[] = [];
  let cardTitle = '';

  test.beforeEach(async ({ page }) => {
    await installFakeViewport(page);

    // 直接落库 + 注入 cookie 登录：走注册表单会踩两个坑
    // （dev 下 fill 可能早于 hydration 导致值被重置；以及每次注册都要等 bcrypt）。
    const email = `e2e-mobile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
    createdEmails.push(email);
    const password = await bcrypt.hash('password123', 10);
    const user = await prisma.user.create({ data: { email, name: '移动端', password } });
    const project = await prisma.project.create({ data: { name: '移动端项目', userId: user.id } });
    cardTitle = `移动端卡片-${Date.now()}`;
    await prisma.card.create({
      data: { title: cardTitle, userId: user.id, projectId: project.id, status: 'todo', position: 0 },
    });

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'dev-secret-change-me',
      { expiresIn: '1h' },
    );
    await page.context().addCookies([
      { name: 'token', value: token, domain: 'localhost', path: '/' },
    ]);

    await page.goto(`/?project=${project.id}`);
    await expect(page.getByText(cardTitle, { exact: true }).first()).toBeVisible({ timeout: 15000 });
  });

  test.afterAll(async () => {
    for (const email of createdEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  test('新建卡片面板不超出视口，表单项字号 ≥16px', async ({ page }) => {
    await openAddSheet(page);

    const g = await geometry(page);
    expect(g.panel.x).toBeGreaterThanOrEqual(-0.5);
    expect(g.panel.right).toBeLessThanOrEqual(g.visibleWidth + 0.5);
    expect(g.panel.width).toBeLessThanOrEqual(g.visibleWidth + 0.5);
    // 面板不能把页面撑出横向滚动
    expect(g.docScrollWidth).toBeLessThanOrEqual(g.layoutWidth + 0.5);
    for (const size of g.fontSizes) expect(size).toBeGreaterThanOrEqual(16);
  });

  test('键盘弹起后面板仍贴在可视区底部', async ({ page }) => {
    await openAddSheet(page);

    await page.getByPlaceholder('输入卡片标题...').focus();
    await setVp(page, 'keyboard', 320);
    const g = await geometry(page);

    // 面板底边 = 可视视口底边（1px 容差），既没被顶出屏幕，也没被 marginBottom 二次补偿顶飞
    expect(g.panel.bottom).toBeLessThanOrEqual(g.visibleTop + g.visibleHeight + 1);
    expect(g.panel.bottom).toBeGreaterThan(g.visibleTop + g.visibleHeight - 2);
    expect(g.panel.right).toBeLessThanOrEqual(g.visibleWidth + 0.5);
    // 键盘占掉一半后，面板仍有可用高度
    expect(g.panel.height).toBeGreaterThan(120);
  });

  test('可视视口被平移时面板跟着平移', async ({ page }) => {
    await openAddSheet(page);

    await setVp(page, 'pan', 24, 10);
    const g = await geometry(page);
    expect(g.visibleLeft).toBe(24);
    expect(g.panel.x).toBeCloseTo(g.visibleLeft, 0);
    expect(g.panel.right).toBeLessThanOrEqual(g.visibleLeft + g.visibleWidth + 1);
  });

  test('编辑时聚焦的输入框被滚进可视区', async ({ page }) => {
    await openCardSheet(page, cardTitle);

    await page.getByPlaceholder('添加评论...').fill('很长的一段评论'.repeat(10));
    await page.getByPlaceholder('添加评论...').focus();
    await setVp(page, 'keyboard', 320);
    await page.waitForTimeout(900);

    const box = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport!;
      return { top: r.top, bottom: r.bottom, vTop: vv.offsetTop, vBottom: vv.offsetTop + vv.height };
    });
    expect(box.bottom).toBeLessThanOrEqual(box.vBottom + 1);
    expect(box.top).toBeGreaterThanOrEqual(box.vTop - 1);
  });
});
