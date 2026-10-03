import type { Page, Locator } from '@playwright/test';

/**
 * 受控输入框在 React 水合完成前 fill 是无效的：值写进了 DOM，
 * 紧接着水合又把 state（空串）回灌进去，表单校验静默失败，
 * 表现为「点了注册但页面不动」。这里填完立刻回读校验，没生效就等水合再填。
 */
export async function fillWhenReady(locator: Locator, value: string) {
  for (let i = 0; i < 20; i++) {
    await locator.fill(value);
    if ((await locator.inputValue()) === value) return;
    await locator.page().waitForTimeout(250);
  }
  throw new Error(`输入框始终不接受值：${value}`);
}

/** 注册并等待跳回看板 */
export async function registerUser(page: Page, name: string, email: string, password = 'password123') {
  await page.goto('/register');
  await fillWhenReady(page.getByPlaceholder('你的名字'), name);
  await fillWhenReady(page.getByPlaceholder('your@email.com'), email);
  await fillWhenReady(page.getByPlaceholder('至少 6 位字符'), password);
  await page.getByRole('button', { name: '注册', exact: true }).click();
}
