-- Chuyển từ DDL PostgreSQL trên slide sang SQLite, giữ nguyên tên bảng / cột / constraint.
--   uuid    -> TEXT (UUID sinh ở app, format kiểm tra bởi OpenAPI validator)
--   boolean -> INTEGER CHECK (0, 1)
-- STRICT: SQLite không tự ép kiểu ('2' vào cột INTEGER sẽ bị từ chối), gần với PostgreSQL hơn.

CREATE TABLE products (
  id          TEXT PRIMARY KEY NOT NULL,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK (price_cents > 0),
  stock       INTEGER NOT NULL CHECK (stock >= 0),
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT;

CREATE TABLE carts (
  id     TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
         CHECK (status IN ('open', 'checked_out'))
) STRICT;

CREATE TABLE cart_items (
  cart_id    TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  PRIMARY KEY (cart_id, product_id)
) STRICT;
