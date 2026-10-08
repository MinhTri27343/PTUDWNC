# RESTful API có Contract: OpenAPI, Validation và Logging

## 📋 Tổng quan Block 1 (120 phút)

| Thời gian | Nội dung |
|-----------|----------|
| 30 phút đầu | GV trình bày mục 1-4 và đề bài |
| 65 phút | Nhóm thực hành |
| 25 phút cuối | Trình bày kết quả |

---

## 📌 Nội dung chính

### 1. RESTful API và OpenAPI

**OpenAPI là gì?**
- File YAML hoặc JSON mô tả path, method, parameter, body, response và lỗi
- Sinh tài liệu tự động: Swagger UI, Redoc, Scalar tại `/docs`
- Validator dùng cùng file để chặn request sai và đối chiếu response
- Khác với tài liệu viết tay: công cụ phát hiện khi code lệch spec

**Ví dụ một operation trong spec:**
```yaml
/carts/{cartId}/items:
  post:
    operationId: addCartItem
    parameters:
      - $ref: '#/components/parameters/CartId'
    requestBody:
      required: true
      content:
        application/json:
          schema: { $ref: '#/components/schemas/AddItemRequest' }
    responses:
      '201': { $ref: '#/components/responses/Cart' }
      '400': { $ref: '#/components/responses/Error' }
```

**Ví dụ schema request:**
```yaml
AddItemRequest:
  type: object
  additionalProperties: false
  required: [product_id, quantity]
  properties:
    product_id: { type: string, format: uuid }
    quantity: { type: integer, minimum: 1, maximum: 10 }
```

**Contract-first vs Code-first:**

| Contract-first | Code-first |
|----------------|------------|
| Viết `openapi.yaml` trước, code sau | Viết schema trong code, sinh spec từ code |
| Middleware đọc spec (ví dụ: `express-openapi-validator`) | Ví dụ: `zod` + `@asteasolutions/zod-to-openapi` |

### 2. Validation

**Validation ở boundary:**
- **Schema kiểm tra được:** kiểu, định dạng, giới hạn (type, format, minimum, maximum)
- **Cần code nghiệp vụ:** dữ liệu trong DB, trạng thái (tồn kho, cart đã checkout chưa)

**Required, Optional và Null:**
- **Required:** key phải có trong object
- **Optional:** key được phép vắng mặt
- **Null:** chỉ hợp lệ khi schema cho phép `type: [string, 'null']`

### 3. Status Code cho lỗi

| Status | Khi nào | Ví dụ |
|--------|---------|-------|
| 400 | Request sai schema | `quantity` bằng 0 |
| 404 | Resource trên URL không có trong DB | `cartId` không tồn tại |
| 409 | Xung đột với trạng thái hiện tại | Hết tồn kho |
| 422 | Body đúng schema, tham chiếu sai | Product ngừng bán |
| 500 | Lỗi phía server | Mất kết nối DB |

### 4. Error Contract

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request body không hợp lệ",
  "details": [{ "field": "quantity", "issue": "must be <= 10" }],
  "request_id": "7f3c2a9e-1b4d-4c8a-9e21-5d6f0a3b8c10"
}
```

- **code:** chuỗi cố định để client rẽ nhánh
- **message:** chỉ để hiển thị
- **500:** cùng dạng JSON, không chứa stack trace, SQL hay secret

### 5. Logging

**Why:**
- Response lỗi chỉ cho client biết lỗi gì
- Log cho biết lỗi xảy ra ở đâu

**request_id:**
- Sinh cho mỗi request
- Trả trong header `X-Request-Id` và error body

**Thư viện gợi ý:** `pino-http`, `winston`, `morgan`

**Không ghi:** password, token, header `Authorization`

---

## 📝 Bài tập: Cart API

### Người dùng có thể
- Xem danh sách sản phẩm
- Tạo giỏ hàng
- Thêm, đổi số lượng và xóa sản phẩm trong giỏ

### Database Schema

**Bảng products:**
```sql
CREATE TABLE products (
  id          uuid PRIMARY KEY,
  sku         text UNIQUE NOT NULL,
  name        text NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents > 0),
  stock       integer NOT NULL CHECK (stock >= 0),
  is_active   boolean NOT NULL DEFAULT true
);
```
- Seed: 5 product (3 đang bán còn hàng, 1 có `stock = 0`, 1 có `is_active = false`)

**Bảng carts và cart_items:**
```sql
CREATE TABLE carts (
  id     uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'open'
           CHECK (status IN ('open', 'checked_out'))
);

CREATE TABLE cart_items (
  cart_id    uuid REFERENCES carts(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  quantity   integer NOT NULL CHECK (quantity BETWEEN 1 AND 10),
  PRIMARY KEY (cart_id, product_id)
);
```
- Seed: 1 cart có `status = 'checked_out'` để test lỗi

### Endpoint

| Endpoint | Body | Thành công |
|----------|------|------------|
| `GET /products?limit=&offset=` | - | Product đang bán; limit 1-50, mặc định 20 |
| `POST /carts` | - | 201, header `Location` |
| `GET /carts/{cartId}` | - | Cart, items và `subtotal_cents` |
| `POST /carts/{cartId}/items` | `{ product_id, quantity }` | 201, trả cart |
| `PATCH /carts/{cartId}/items/{productId}` | `{ quantity }` | 200, trả cart |
| `DELETE /carts/{cartId}/items/{productId}` | - | 204 |

### Business Rules và Mã lỗi

| Rule | Vi phạm → Status + Code |
|------|-------------------------|
| Product tồn tại và đang bán | 422 `PRODUCT_UNAVAILABLE` |
| Số lượng không vượt tồn kho | 409 `INSUFFICIENT_STOCK` |
| Product chưa có trong cart khi thêm | 409 `ITEM_ALREADY_IN_CART` |
| Chỉ ghi vào cart đang mở | 409 `CART_CLOSED` |
| Schema/URL sai | 400 `VALIDATION_ERROR` |
| Cart/Item không tồn tại | 404 `CART_NOT_FOUND` / `ITEM_NOT_FOUND` |

---

## ✅ Yêu cầu bàn giao

| Hạng mục | Yêu cầu |
|-----------|----------|
| Setup | README ghi lệnh tạo DB, migration, seed, reset, server |
| API | 6 endpoint đúng method, path, status |
| Documentation | OpenAPI 3.1 đủ mọi status; `/docs` chạy được; có example |
| Validation | Chạy từ cùng nguồn schema với spec; request sai không chạm DB |
| Error & Logging | Mọi lỗi theo error contract, kể cả 500; log kèm `request_id` |
| Evidence | Script chạy lại được cho mọi dòng ma trận nghiệm thu |

---

## 🧪 Ma trận nghiệm thu

### Request sai

| Kịch bản | Kết quả cần thấy |
|----------|------------------|
| `quantity` = 0, 11 hoặc `"2"` | 400 `VALIDATION_ERROR`, `details` chỉ `quantity` |
| Thiếu `product_id`; body có field lạ | 400 `VALIDATION_ERROR`; DB không đổi |
| `cartId` không phải uuid | 400 `VALIDATION_ERROR` |
| `cartId` hợp lệ nhưng không tồn tại | 404 `CART_NOT_FOUND` |

### Nghiệp vụ và Server

| Kịch bản | Kết quả cần thấy |
|----------|------------------|
| Thêm 2 product rồi `GET` cart | `subtotal_cents` đúng |
| Product ngừng bán; vượt stock | 422, 409 |
| Ghi vào cart đã checkout | 409 `CART_CLOSED` |
| Tắt PostgreSQL rồi gọi API | 500 đúng error contract, không stack trace |
| So response thật với spec | Mọi response khớp schema |

---

## ⚠️ Lỗi thường gặp

1. **Hai nguồn schema:** spec viết một kiểu, validation trong code viết kiểu khác
2. **Lỗi thư viện lọt ra:** validator trả format riêng, không theo error contract
3. **Tin client:** nhận `price` từ body thay vì đọc từ DB
4. **Dựa vào lỗi DB:** vi phạm `CHECK` constraint thành 500 thay vì 400

---

## 🎤 Presentation

- **Problem:** Cart API cần gì để nhóm khác dùng được mà không đọc source?
- **Solution:** contract-first hay code-first, thư viện đã chọn và lý do
- **Demo:** gửi request sai từ `/docs`, chỉ response lỗi và dòng log có cùng `request_id`
- **Evidence và trade-off:** kết quả ma trận; kịch bản chưa kiểm tra
