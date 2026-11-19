import { test as base, expect, type Page } from '@playwright/test';
import { createApp } from '../src/app.js';
import type { Server } from 'node:http';

const test = base.extend<{labURL: string}>({
  labURL: async ({}, use) => {
    const lab = createApp();
    let server: Server | undefined;
    try {
      server = await new Promise<Server>((resolve, reject) => {
        const listening = lab.app.listen(0, '127.0.0.1', () => resolve(listening));
        listening.once('error', reject);
      });
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test server port');
      await use(`http://127.0.0.1:${address.port}`);
    } finally {
      if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()));}
      lab.close();
    }
  },
});

async function login(page: Page, user: string) {
  await page.locator(`#accounts button[data-user="${user}"]`).click();
  const names: Record<string,string> = {alice:'Alice',bob:'Bob',eve:'Eve (Viewer)',charlie:'Charlie',dana:'Dana'};
  await expect(page.locator('#identity')).toHaveText(`${names[user]} · tenant ${user==='charlie'?'beta':'alpha'}${user==='dana'?' · Admin':''}`);
  await expect(page.locator('#tasks')).not.toContainText('Chưa có dữ liệu.');
}
async function scenario(page: Page, name: string) {
  const toggle = page.locator('#result-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  const select = page.locator('#scenarios');
  const label = await select.locator(`option[value="${name}"]`).textContent();
  const message = `Đã chuẩn bị tình huống “${label}” ở ${await page.locator('#version').inputValue()}. Bấm Gửi request để thực hiện.`;
  await select.selectOption(name);
  await expect(page.locator('#status')).toHaveText(message);
}
async function send(page: Page, code: number) {
  const toggle = page.locator('#result-toggle');
  if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
  const method = await page.locator('#method').inputValue();
  const url = `${new URL(page.url()).origin}/api/${await page.locator('#version').inputValue()}${await page.locator('#path').inputValue()}`;
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url() === url && r.request().method() === method),
    page.locator('#request-form > button').click(),
  ]);
  expect(response.status()).toBe(code);
  await expect(page.locator('#http-status')).toContainText(String(code));
}

test.beforeEach(async ({page,labURL}) => {await page.goto(labURL);});

test('đăng nhập, danh sách đã lọc, đăng xuất và token không lưu lại sau reload',async({page})=>{
  await login(page,'alice');
  await expect(page.locator('#projects tr')).toHaveCount(1);
  await expect(page.locator('#tasks tr')).toHaveCount(3);
  await expect(page.locator('#tasks')).not.toContainText('B1');
  await page.reload();
  await expect(page.locator('#identity')).toHaveText('Chưa đăng nhập');
  await login(page,'charlie');
  await expect(page.locator('#tasks tr')).toHaveCount(2);
  await page.locator('#logout').click();
  await expect(page.locator('#identity')).toHaveText('Chưa đăng nhập');
  await expect(page.locator('#tasks')).toContainText('Chưa có dữ liệu.');
});

test('đăng nhập sai có lỗi rõ ràng và không có dữ liệu',async({page})=>{
  await page.locator('#manual-login > summary').click();
  await page.locator('#password').fill('sai-mat-khau');
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator('#status')).toContainText('Đăng nhập thất bại');
  await expect(page.locator('#http-status')).toContainText('401');
  await expect(page.locator('#tasks')).toContainText('Chưa có dữ liệu.');
});

test('Starter lộ B1, V1 và V4 chặn; đọc A1 vẫn được phép',async({page})=>{
  await page.locator('#version').selectOption('starter');
  await scenario(page,'idor'); await send(page,200);
  await expect(page.locator('#response')).toContainText('Ngân sách dự án Beta');
  await expect(page.locator('#tasks tr')).toHaveCount(5);
  await page.locator('#version').selectOption('v1'); await send(page,403);
  await expect(page.locator('#response')).not.toContainText('Ngân sách');
  await page.locator('#version').selectOption('v4'); await send(page,403);
  await scenario(page,'allow'); await send(page,200);
  await expect(page.locator('#response')).toContainText('Thiết kế màn hình đăng nhập');
  await page.locator('#curl-details > summary').click();
  await expect(page.locator('#request-preview')).toContainText('Bearer <TOKEN>');
  await expect(page.locator('#request-preview')).not.toContainText('eyJ');
});

test('RBAC: Viewer bị chặn sửa, Member sửa được nhưng không quản lý thành viên',async({page})=>{
  await page.locator('#version').selectOption('v2');
  await scenario(page,'viewer'); await send(page,403);
  await scenario(page,'assigned'); await send(page,200);
  await expect(page.locator('#tasks')).toContainText('Bob cập nhật A1');
  await page.locator('#projects button[data-members="alpha"]').click();
  await expect(page.locator('#member-list')).toContainText('forbidden');
});

test('V2 cho Bob sửa A2; V3 chỉ cho task được giao và Open',async({page})=>{
  await page.locator('#version').selectOption('v2');
  await scenario(page,'unassigned'); await send(page,200);
  await page.locator('#version').selectOption('v3');
  await scenario(page,'unassigned'); await send(page,403);
  await scenario(page,'closed'); await send(page,403);
  await scenario(page,'assigned'); await send(page,200);
});

test('V4 chặn giả role/user/tenant; V3 còn cho Admin đọc khác tenant',async({page})=>{
  await page.locator('#version').selectOption('v3');
  await scenario(page,'tenant'); await send(page,200);
  await page.locator('#version').selectOption('v4');
  await scenario(page,'admin-own'); await send(page,200);
  await scenario(page,'forge-tenant'); await send(page,403);
  await expect(page.locator('#extra-headers')).toHaveValue(/X-Tenant-Id/);
  await scenario(page,'forge-role'); await send(page,403);
  await expect(page.locator('#body')).toHaveValue(/Admin/);
  await scenario(page,'forge-user'); await send(page,403);
  await expect(page.locator('#projects')).toContainText('Project Alpha');
});

test('Owner sửa task Closed bằng dialog, kết quả được lưu thật',async({page})=>{
  await login(page,'alice');
  await page.locator('#tasks button[data-edit="A3"]').click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await page.locator('#edit-description').fill('Owner đã cập nhật task Closed');
  await page.locator('#edit-form').getByRole('button',{name:'Lưu thay đổi'}).click();
  await expect(page.locator('#edit-dialog')).not.toBeVisible();
  await expect(page.locator('#http-status')).toContainText('200');
  await page.locator('#tasks button[data-read="A3"]').click();
  await expect(page.locator('#response')).toContainText('Owner đã cập nhật task Closed');
});

test('Member không thể tự giao A2 hoặc mở lại task Closed',async({page})=>{
  await login(page,'bob');
  await page.locator('#tasks button[data-edit="A2"]').click();
  await expect(page.locator('#edit-dialog')).toBeVisible();
  await page.locator('#edit-assignee').fill('bob');
  await page.locator('#edit-form').getByRole('button',{name:'Lưu thay đổi'}).click();
  await expect(page.locator('#http-status')).toContainText('403');
  await expect(page.locator('#tasks tr').filter({hasText:'A2'})).toContainText('Chưa giao');
  await page.locator('#tasks button[data-edit="A3"]').click();
  await page.locator('#edit-status').selectOption('Open');
  await page.locator('#edit-form').getByRole('button',{name:'Lưu thay đổi'}).click();
  await expect(page.locator('#http-status')).toContainText('403');
  await expect(page.locator('#tasks tr').filter({hasText:'A3'})).toContainText('Closed');
});

test('Owner thêm/đổi/gỡ thành viên, giữ Owner cuối cùng; token cũ Bob mất quyền ngay',async({page,context,labURL})=>{
  await login(page,'alice');
  const bob=await context.newPage(); await bob.goto(labURL); await login(bob,'bob');
  await page.locator('#projects button[data-members="alpha"]').click();
  await expect(page.locator('#member-list')).toContainText('Owner');
  await page.locator('#member-user').fill('dana');
  await page.locator('#member-role').selectOption('Viewer');
  await page.locator('#member-form button').filter({hasText:'Gửi thay đổi'}).click();
  await expect(page.locator('#member-list')).toContainText('dana');
  await page.locator('#member-method').selectOption('PATCH');
  await page.locator('#member-role').selectOption('Member');
  await page.locator('#member-form button').filter({hasText:'Gửi thay đổi'}).click();
  await expect(page.locator('#response')).toContainText('true');
  await page.locator('#member-method').selectOption('DELETE');
  await page.locator('#member-user').fill('bob');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#member-form button').filter({hasText:'Gửi thay đổi'}).click();
  await expect(page.locator('#member-list')).not.toContainText('"userId": "bob"');
  await bob.locator('#refresh').click();
  await expect(bob.locator('#tasks')).toContainText('Không có task được phép xem.');
  await bob.locator('#path').fill('/tasks/A1'); await send(bob,403);
  await page.locator('#member-user').fill('alice');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#member-form button').filter({hasText:'Gửi thay đổi'}).click();
  await expect(page.locator('#http-status')).toContainText('409');
  await expect(page.locator('#response')).toContainText('last_owner');
});

test('xóa project thật và dữ liệu các phiên bản độc lập',async({page})=>{
  await login(page,'alice');
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#projects button[data-delete="alpha"]').click();
  await expect(page.locator('#tasks')).toContainText('Không có task được phép xem.');
  await page.locator('#version').selectOption('v3');
  await expect(page.locator('#tasks tr')).toHaveCount(3);
  await expect(page.locator('#projects')).toContainText('Project Alpha');
});

test('request thiếu token, task không tồn tại và JSON sai có phản hồi rõ ràng',async({page})=>{
  await scenario(page,'anonymous'); await send(page,401);
  await login(page,'alice');
  await page.locator('#with-token').check();
  await page.locator('#path').fill('/tasks/Z9'); await send(page,404);
  await page.locator('#method').selectOption('PATCH');
  await page.locator('#body').fill('{');
  await page.locator('#request-form > button').click();
  await expect(page.locator('#status')).toHaveClass('error');
});

test('bố cục desktop/mobile không tràn ngang, lưu ảnh demo',async({page})=>{
  await login(page,'alice');
  await expect(page.locator('#accounts button[data-user="alice"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#manual-login')).not.toHaveAttribute('open','');
  const accounts = await page.locator('#accounts button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); return {top:rect.top,bottom:rect.bottom};
  }));
  expect(accounts.every((rect,index) => index === 0 || rect.top >= accounts[index-1].bottom)).toBe(true);
  await scenario(page,'allow'); await send(page,200);
  await expect(page.getByLabel('Phiên bản', {exact:true})).toHaveCount(1);
  await expect(page.locator('#scenarios')).toHaveValue('allow');
  await page.screenshot({path:'evidence/ui-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#version')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await scenario(page,'idor'); await send(page,403);
  await page.screenshot({path:'evidence/ui-mobile.png'});
});

test('xem kết quả ngay tại chỗ, không cuộn trang sau khi gửi trên desktop và mobile', async ({page}) => {
  await scenario(page, 'idor');
  await page.locator('#request-form > button').scrollIntoViewIfNeeded();
  const desktopY = await page.evaluate(() => window.scrollY);
  await send(page, 403);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - desktopY)).toBeLessThanOrEqual(2);
  await expect(page.locator('#http-status')).toBeInViewport();
  await expect(page.locator('#response')).toBeInViewport();
  await page.setViewportSize({width:390,height:844});
  await scenario(page, 'allow');
  await page.locator('#request-form > button').scrollIntoViewIfNeeded();
  const mobileY = await page.evaluate(() => window.scrollY);
  await send(page, 200);
  expect(Math.abs(await page.evaluate(() => window.scrollY) - mobileY)).toBeLessThanOrEqual(2);
  await expect(page.locator('#response')).toBeInViewport();
  await expect(page.locator('#result-toggle')).toHaveText('Thu gọn');
  await page.locator('#result-toggle').click();
  await expect(page.locator('#response')).toBeHidden();
});
