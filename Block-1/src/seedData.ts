// Dữ liệu seed với UUID cố định — dùng chung cho seed, test và requests.http.

export const PRODUCT_IDS = {
  P1: 'a0000000-0000-4000-8000-000000000001',
  P2: 'a0000000-0000-4000-8000-000000000002',
  P3: 'a0000000-0000-4000-8000-000000000003',
  P4_OUT_OF_STOCK: 'a0000000-0000-4000-8000-000000000004',
  P5_INACTIVE: 'a0000000-0000-4000-8000-000000000005',
} as const;

export const CART_IDS = {
  OPEN: 'c0000000-0000-4000-8000-000000000001',
  CLOSED: 'c0000000-0000-4000-8000-000000000002',
} as const;

export const SEED_PRODUCTS = [
  { id: PRODUCT_IDS.P1, sku: 'SKU-001', name: 'Áo thun cotton', price_cents: 15000, stock: 20, is_active: 1 },
  { id: PRODUCT_IDS.P2, sku: 'SKU-002', name: 'Quần jean', price_cents: 25000, stock: 5, is_active: 1 },
  { id: PRODUCT_IDS.P3, sku: 'SKU-003', name: 'Tất cổ ngắn', price_cents: 9900, stock: 100, is_active: 1 },
  { id: PRODUCT_IDS.P4_OUT_OF_STOCK, sku: 'SKU-004', name: 'Áo khoác (hết hàng)', price_cents: 50000, stock: 0, is_active: 1 },
  { id: PRODUCT_IDS.P5_INACTIVE, sku: 'SKU-005', name: 'Mũ lưỡi trai (ngừng bán)', price_cents: 30000, stock: 10, is_active: 0 },
];

export const SEED_CARTS = [
  { id: CART_IDS.OPEN, status: 'open' },
  { id: CART_IDS.CLOSED, status: 'checked_out' },
];

// Cart đã checkout có sẵn 1 item để GET thấy nội dung và thử PATCH/DELETE → 409 CART_CLOSED.
export const SEED_CART_ITEMS = [{ cart_id: CART_IDS.CLOSED, product_id: PRODUCT_IDS.P1, quantity: 1 }];
