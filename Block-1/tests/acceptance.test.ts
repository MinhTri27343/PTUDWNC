import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { getDb, setDb } from '../src/db';
import {
  CART_IDS,
  PRODUCT_IDS,
  countCartItems,
  expectErrorContract,
  setupTest,
  snapshotDb,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeEach(async () => {
  t = await setupTest();
});
afterEach(() => t.cleanup());

const addItem = (cartId: string, body: unknown) =>
  request(t.app).post(`/carts/${cartId}/items`).set(t.auth).send(body as object);

describe('A. Request sai → 400/404, DB không đổi', () => {
  it.each([
    ['quantity = 0', 0],
    ['quantity = 11', 11],
    ['quantity = "2" (chuỗi)', '2'],
  ])('A1 %s → 400 VALIDATION_ERROR, details chỉ có quantity', async (_name, quantity) => {
    const before = snapshotDb();
    const res = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity });
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details).toHaveLength(1);
    expect(res.body.details[0].field).toBe('quantity');
    expect(snapshotDb()).toBe(before);
  });

  it('A2 thiếu product_id → 400, DB không đổi', async () => {
    const before = snapshotDb();
    const res = await addItem(CART_IDS.OPEN, { quantity: 2 });
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details.map((d: any) => d.field)).toEqual(['product_id']);
    expect(snapshotDb()).toBe(before);
  });

  it('A3 body có field lạ (price) → 400, DB không đổi', async () => {
    const before = snapshotDb();
    const res = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 2, price: 1 });
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details.map((d: any) => d.field)).toEqual(['price']);
    expect(snapshotDb()).toBe(before);
  });

  it('A4 cartId không phải uuid → 400', async () => {
    const res = await request(t.app).get('/carts/not-a-uuid').set(t.auth);
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe('cartId');
  });

  it('A5 cartId hợp lệ nhưng không tồn tại → 404 CART_NOT_FOUND', async () => {
    const res = await request(t.app).get('/carts/00000000-0000-4000-8000-000000000000').set(t.auth);
    expectErrorContract(res, 404, 'CART_NOT_FOUND');
  });

  it('A6 product_id sai định dạng uuid → 400 (format uuid được kiểm tra)', async () => {
    const res = await addItem(CART_IDS.OPEN, { product_id: 'abc', quantity: 2 });
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
    expect(res.body.details[0].field).toBe('product_id');
  });

  it('A7 JSON hỏng → 400 theo error contract (không lộ format của body-parser)', async () => {
    const res = await request(t.app)
      .post(`/carts/${CART_IDS.OPEN}/items`)
      .set(t.auth)
      .set('Content-Type', 'application/json')
      .send('{"product_id": ');
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
  });

  it('A8 route không tồn tại → 404 NOT_FOUND theo contract', async () => {
    const res = await request(t.app).get('/nope').set(t.auth);
    expectErrorContract(res, 404, 'NOT_FOUND');
  });
});

describe('B. Nghiệp vụ', () => {
  it('B1 thêm P1×2 + P3×3 rồi GET → subtotal_cents = 59700 (tính tay từ seed)', async () => {
    const r1 = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 2 });
    expect(r1.status).toBe(201);
    const r2 = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P3, quantity: 3 });
    expect(r2.status).toBe(201);

    const res = await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set(t.auth);
    expect(res.status).toBe(200);
    expect(res.body.subtotal_cents).toBe(15000 * 2 + 9900 * 3); // 59700
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({ unit_price_cents: 15000, quantity: 2, line_total_cents: 30000 });
    expect(res.body.items[1]).toMatchObject({ unit_price_cents: 9900, quantity: 3, line_total_cents: 29700 });
  });

  it('B2 product ngừng bán → 422 PRODUCT_UNAVAILABLE', async () => {
    const before = snapshotDb();
    const res = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P5_INACTIVE, quantity: 1 });
    expectErrorContract(res, 422, 'PRODUCT_UNAVAILABLE');
    expect(snapshotDb()).toBe(before);
  });

  it('B2b product không tồn tại trong DB → 422 (không phải 404)', async () => {
    const res = await addItem(CART_IDS.OPEN, { product_id: '00000000-0000-4000-8000-000000000000', quantity: 1 });
    expectErrorContract(res, 422, 'PRODUCT_UNAVAILABLE');
  });

  it('B3 vượt stock / stock = 0 → 409 INSUFFICIENT_STOCK', async () => {
    const before = snapshotDb();
    // P2 stock = 5
    expectErrorContract(await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P2, quantity: 6 }), 409, 'INSUFFICIENT_STOCK');
    // P4 stock = 0
    expectErrorContract(
      await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P4_OUT_OF_STOCK, quantity: 1 }),
      409,
      'INSUFFICIENT_STOCK',
    );
    expect(snapshotDb()).toBe(before);
  });

  it('B3b PATCH vượt stock → 409 INSUFFICIENT_STOCK', async () => {
    await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P2, quantity: 1 });
    const res = await request(t.app)
      .patch(`/carts/${CART_IDS.OPEN}/items/${PRODUCT_IDS.P2}`)
      .set(t.auth)
      .send({ quantity: 6 });
    expectErrorContract(res, 409, 'INSUFFICIENT_STOCK');
  });

  it('B4 ghi vào cart đã checkout (POST / PATCH / DELETE) → 409 CART_CLOSED, DB không đổi', async () => {
    const before = snapshotDb();
    expectErrorContract(await addItem(CART_IDS.CLOSED, { product_id: PRODUCT_IDS.P3, quantity: 1 }), 409, 'CART_CLOSED');
    expectErrorContract(
      await request(t.app).patch(`/carts/${CART_IDS.CLOSED}/items/${PRODUCT_IDS.P1}`).set(t.auth).send({ quantity: 2 }),
      409,
      'CART_CLOSED',
    );
    expectErrorContract(
      await request(t.app).delete(`/carts/${CART_IDS.CLOSED}/items/${PRODUCT_IDS.P1}`).set(t.auth),
      409,
      'CART_CLOSED',
    );
    expect(snapshotDb()).toBe(before);
  });

  it('B5 thêm trùng product → 409 ITEM_ALREADY_IN_CART', async () => {
    await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 1 });
    const res = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 1 });
    expectErrorContract(res, 409, 'ITEM_ALREADY_IN_CART');
    expect(countCartItems()).toBe(2); // 1 item seed của cart CLOSED + 1 vừa thêm
  });

  it('B6 PATCH / DELETE item không có trong cart → 404 ITEM_NOT_FOUND', async () => {
    expectErrorContract(
      await request(t.app).patch(`/carts/${CART_IDS.OPEN}/items/${PRODUCT_IDS.P1}`).set(t.auth).send({ quantity: 2 }),
      404,
      'ITEM_NOT_FOUND',
    );
    expectErrorContract(
      await request(t.app).delete(`/carts/${CART_IDS.OPEN}/items/${PRODUCT_IDS.P1}`).set(t.auth),
      404,
      'ITEM_NOT_FOUND',
    );
  });

  it('B6b PATCH / DELETE trên cart không tồn tại → 404 CART_NOT_FOUND', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expectErrorContract(
      await request(t.app).patch(`/carts/${missing}/items/${PRODUCT_IDS.P1}`).set(t.auth).send({ quantity: 2 }),
      404,
      'CART_NOT_FOUND',
    );
    expectErrorContract(await request(t.app).delete(`/carts/${missing}/items/${PRODUCT_IDS.P1}`).set(t.auth), 404, 'CART_NOT_FOUND');
  });

  it('B7 POST /carts → 201 + header Location, cart rỗng', async () => {
    const res = await request(t.app).post('/carts').set(t.auth);
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/carts/${res.body.id}`);
    expect(res.body).toMatchObject({ status: 'open', items: [], subtotal_cents: 0 });
  });

  it('B7b PATCH đổi số lượng → 200 trả cả cart; DELETE → 204', async () => {
    await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 1 });
    const patch = await request(t.app)
      .patch(`/carts/${CART_IDS.OPEN}/items/${PRODUCT_IDS.P1}`)
      .set(t.auth)
      .send({ quantity: 4 });
    expect(patch.status).toBe(200);
    expect(patch.body.subtotal_cents).toBe(60000);

    const del = await request(t.app).delete(`/carts/${CART_IDS.OPEN}/items/${PRODUCT_IDS.P1}`).set(t.auth);
    expect(del.status).toBe(204);
    expect(del.text).toBe('');
    const cart = await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set(t.auth);
    expect(cart.body.items).toEqual([]);
  });

  it('B8 GET /products: chỉ product đang bán, mặc định ≤ 20; limit/offset; limit 0 hoặc 51 → 400', async () => {
    const all = await request(t.app).get('/products');
    expect(all.status).toBe(200);
    expect(Array.isArray(all.body)).toBe(true);
    expect(all.body.map((p: any) => p.sku)).toEqual(['SKU-001', 'SKU-002', 'SKU-003', 'SKU-004']); // không có SKU-005
    expect(all.body.every((p: any) => p.is_active === true)).toBe(true);

    const page = await request(t.app).get('/products?limit=2&offset=1');
    expect(page.body.map((p: any) => p.sku)).toEqual(['SKU-002', 'SKU-003']);

    expectErrorContract(await request(t.app).get('/products?limit=0'), 400, 'VALIDATION_ERROR');
    expectErrorContract(await request(t.app).get('/products?limit=51'), 400, 'VALIDATION_ERROR');
    expectErrorContract(await request(t.app).get('/products?foo=1'), 400, 'VALIDATION_ERROR');
  });

  it('B9 client không điều khiển được giá: gửi price bị từ chối, subtotal luôn từ DB', async () => {
    const res = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 1, price_cents: 1 });
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
  });
});

describe('C. Lỗi server và đối chiếu spec', () => {
  it('C1 DB không dùng được → 500 INTERNAL_ERROR đúng contract, không lộ stack/SQL/đường dẫn', async () => {
    getDb().close();
    setDb(undefined);
    config.dbPath = config.dbPath + '.missing'; // file không tồn tại → mở kết nối thất bại

    const res = await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set(t.auth);
    expectErrorContract(res, 500, 'INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/missing|unable to open|cart\.db|test\.db/i);

    // Lỗi chi tiết nằm trong log của server, kèm request_id
    const line = t.logs.find((l) => l.req?.id === res.body.request_id && l.err);
    expect(line, 'log phải chứa lỗi thật của request này').toBeTruthy();
  });

  it('C1b DB lỗi nhưng /products và /login vẫn đúng contract (products → 500, login → 200)', async () => {
    getDb().close();
    setDb(undefined);
    config.dbPath = config.dbPath + '.missing';
    expectErrorContract(await request(t.app).get('/products'), 500, 'INTERNAL_ERROR');
    const login = await request(t.app).post('/login').send({ username: 'user', password: '1234' });
    expect(login.status).toBe(200);
  });

  it('C3 từ request_id trong response lỗi tìm được dòng log tương ứng', async () => {
    const res = await addItem(CART_IDS.OPEN, { product_id: PRODUCT_IDS.P1, quantity: 0 });
    expectErrorContract(res, 400, 'VALIDATION_ERROR');
    const lines = t.logs.filter((l) => l.req?.id === res.body.request_id);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.res?.statusCode === 400)).toBe(true);
  });

  it('C3b client gửi X-Request-Id hợp lệ → server dùng lại; không hợp lệ → server tự sinh', async () => {
    const mine = '7f3c2a9e-1b4d-4c8a-9e21-5d6f0a3b8c10';
    const ok = await request(t.app).get('/products').set('X-Request-Id', mine);
    expect(ok.headers['x-request-id']).toBe(mine);
    const bad = await request(t.app).get('/products').set('X-Request-Id', 'abc');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('C4 log không chứa password, token hay header Authorization', async () => {
    await request(t.app).post('/login').send({ username: 'user', password: '1234' });
    await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set(t.auth);
    const raw = JSON.stringify(t.logs);
    expect(raw).not.toContain(t.token);
    expect(raw).not.toContain('"password":"1234"');
  });

  it('C2 /docs và /openapi.yaml chạy được, không cần token', async () => {
    const yaml = await request(t.app).get('/openapi.yaml');
    expect(yaml.status).toBe(200);
    expect(yaml.text).toContain('openapi: 3.1.0');
    const docs = await request(t.app).get('/docs/');
    expect(docs.status).toBe(200);
    expect(docs.text).toContain('swagger-ui');
  });
});

describe('D. Authentication', () => {
  it('D1 POST /login đúng → 200 + Bearer token', async () => {
    const res = await request(t.app).post('/login').send({ username: 'user', password: '1234' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    expect(typeof res.body.access_token).toBe('string');
  });

  it('D1 sai password / sai username → 401 INVALID_CREDENTIALS', async () => {
    expectErrorContract(await request(t.app).post('/login').send({ username: 'user', password: 'x' }), 401, 'INVALID_CREDENTIALS');
    expectErrorContract(await request(t.app).post('/login').send({ username: 'admin', password: '1234' }), 401, 'INVALID_CREDENTIALS');
  });

  it('D1 thiếu field / field lạ → 400 VALIDATION_ERROR', async () => {
    expectErrorContract(await request(t.app).post('/login').send({ username: 'user' }), 400, 'VALIDATION_ERROR');
    expectErrorContract(await request(t.app).post('/login').send({ username: 'user', password: '1234', role: 'admin' }), 400, 'VALIDATION_ERROR');
  });

  it('D2 /carts không token / token rác / sai scheme → 401 UNAUTHORIZED', async () => {
    expectErrorContract(await request(t.app).post('/carts'), 401, 'UNAUTHORIZED');
    expectErrorContract(await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set('Authorization', 'Bearer garbage'), 401, 'UNAUTHORIZED');
    expectErrorContract(await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set('Authorization', `Basic ${t.token}`), 401, 'UNAUTHORIZED');
  });

  it('D2 token hết hạn → 401 UNAUTHORIZED', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const expired = jwt.sign({ sub: 'user' }, config.jwtSecret, { expiresIn: -10 });
    expectErrorContract(await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set('Authorization', `Bearer ${expired}`), 401, 'UNAUTHORIZED');
  });

  it('D2 token ký bằng secret khác → 401', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: 'user' }, 'another-secret');
    expectErrorContract(await request(t.app).get(`/carts/${CART_IDS.OPEN}`).set('Authorization', `Bearer ${forged}`), 401, 'UNAUTHORIZED');
  });

  it('D2 401 đến trước 400: không token + body sai → 401, không phải 400', async () => {
    const res = await request(t.app).post(`/carts/${CART_IDS.OPEN}/items`).send({ quantity: 0 });
    expectErrorContract(res, 401, 'UNAUTHORIZED');
  });

  it('D2 GET /products không cần token → 200', async () => {
    expect((await request(t.app).get('/products')).status).toBe(200);
  });
});
