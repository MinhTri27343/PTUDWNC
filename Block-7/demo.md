# Kịch bản demo (≈ 12 phút)

## Chuẩn bị
1. `npm start` → mở http://127.0.0.1:3000.
2. Mở **4 tab**: 🛒 Cửa hàng · 📦 Kho hàng · 💳 Thanh toán · ⚙️ Admin.
3. Màn hình nên chia đôi: **trái = Cửa hàng**, **phải = Admin** (bảng *Flow hành vi các service*).

## Quy tắc chung cho mọi tình huống
- **Trước mỗi tình huống:** Admin → **↺ Reset dữ liệu** (về số liệu ban đầu, gỡ hết lỗi).
- **Cài lỗi:** Admin → chọn lỗi trong dropdown của service → kiểm tra số lần (×) → **Cài lỗi** → thấy nhãn ⚠ màu cam.
- **Lỗi chỉ nổ ở đúng 1 bước** (đọc dòng ⓘ dưới dropdown). Cài xong rồi mới **đặt hàng ở Cửa hàng**.
- **Bảng Flow** tự theo đơn mới nhất, **dòng mới nhất nằm trên cùng**.
  Màu: 🔵 Order gọi service · 🟢 thành công · 🔴 từ chối · 🟣 không rõ kết quả / hỏi lại · 🟠 bước bù.

Số liệu ban đầu: Alice 1.000.000 đ, Bob 200.000 đ, Carol 50.000 đ. Tai nghe 100.000 đ (10 cái), Đồng hồ 300.000 đ (5 cái), Laptop 800.000 đ (2 cái).

---

## 1. H0 · Mua thành công (không cài lỗi)
**Làm:** Cửa hàng → Alice đặt **1 Tai nghe**.
**Nhìn:**
- Cửa hàng: đơn **Thành công**, ví **900.000 đ**, tai nghe còn 9.
- Admin/Flow: Tạo đơn → Giữ hàng 🟢 (Inventory) → Thu tiền 🟢 (Payment) → Xác nhận 🟢 → **CONFIRMED**.

> **Kết luận:** Mỗi bước là 1 giao dịch local trong DB của service đó; Order điều phối tuần tự → CONFIRMED.

## 2. F1 · Inventory → *Từ chối giữ hàng*
**Làm:** Admin → Inventory → **Từ chối giữ hàng** ×1 → Cài lỗi. Cửa hàng → Alice đặt 1 Tai nghe.
*(Cách khác không cần cài lỗi: đặt **11** Tai nghe.)*
**Nhìn:**
- Cửa hàng: đơn **Đã hủy**, ví không đổi.
- Flow: Giữ hàng 🔴 *RESERVE_REJECTED* → **CANCELLED**. Cột Payment **trống**.

> **Kết luận:** Bước đầu tiên bị từ chối → chưa có gì để bù → hủy ngay, không gọi Payment.

## 3. F2 · Payment → *Từ chối thanh toán*
**Làm:** Admin → Payment → **Từ chối thanh toán** ×1 → Cài lỗi. Cửa hàng → Alice đặt 1 Tai nghe.
*(Cách khác: đổi sang **Carol**, đặt 1 Đồng hồ — không đủ tiền.)*
**Nhìn:**
- Flow: Giữ hàng 🟢 → Thu tiền 🔴 *CHARGE_DECLINED* → **COMPENSATING** → Trả hàng 🟠 (Inventory) → **CANCELLED**.
- Kho hàng: lịch sử có **−1 xuất cho đơn** rồi **+1 đơn hủy, trả lại kho**.

> **Kết luận:** Thu tiền thất bại → Saga **bù bước trước đó** (trả hàng về kho) rồi mới hủy.

## 4. F3 · Order → *Từ chối xác nhận đơn*
**Làm:** Admin → Order → **Từ chối xác nhận đơn** ×1 → Cài lỗi. Cửa hàng → Alice đặt 1 Tai nghe.
**Nhìn:**
- Cửa hàng: đơn **Đã hủy**; Lịch sử ví có **−100.000** rồi **+100.000**.
- Flow: Giữ 🟢 → Thu tiền 🟢 → Xác nhận 🔴 → **COMPENSATING** → **Hoàn tiền 🟠 → Trả hàng 🟠** → **CANCELLED**.
- Thanh toán: có cả dòng Thanh toán và Hoàn tiền.

> **Kết luận:** Lỗi xảy ra **sau khi đã thu tiền** → bù **ngược thứ tự**: hoàn tiền trước, trả hàng sau. Sổ cái giữ cả 2 dòng, không xoá.

## 5. F4 · Payment → *Sập ngay sau khi thu tiền* ⭐
**Làm:** Admin → Payment → **Sập ngay sau khi thu tiền** ×1 → Cài lỗi. Cửa hàng → Alice đặt 1 Tai nghe.
**Nhìn (lúc Payment chết):**
- Admin: dòng Payment chuyển **đỏ – ĐÃ TẮT** (process chết thật).
- Flow: Thu tiền 🟣 *không rõ kết quả (ECONNRESET)* → **RECOVERING** → 🟣 hỏi lại payment theo op_id → *UNREACHABLE* (lặp lại mỗi 2 giây).
- Cửa hàng: đơn **Đang xử lý** (không hủy!), ví "tạm thời không xem được".

**Làm tiếp:** Admin → Payment → **Bật lại**.
**Nhìn:** Flow: hỏi lại → **SUCCEEDED** → Thu tiền 🟢 → Xác nhận 🟢 → **CONFIRMED**. Thanh toán: chỉ **1** dòng thanh toán.

> **Kết luận:** **Timeout ≠ thất bại.** Payment có thể đã thu tiền → Order giữ **RECOVERING**, hỏi lại bằng **đúng op_id cũ**, không hủy, không thu lần 2.

## 6. F5 · Order → *Từ chối xác nhận* + Payment → *Hoàn tiền lỗi tạm thời*
**Làm:**
1. Admin → Order → **Từ chối xác nhận đơn** ×1 → Cài lỗi.
2. Admin → Payment → **Hoàn tiền lỗi tạm thời** ×4 → Cài lỗi.
3. Cửa hàng → Alice đặt 1 Tai nghe.

**Nhìn:**
- Flow: Xác nhận 🔴 → **COMPENSATING**, ô trên bảng: *bù còn chờ: refund → release*.
- Flow lặp lại: Hoàn tiền 🟣 *503* → hỏi lại → *NOT_FOUND* → gọi lại cùng op_id… (nhãn ⚠ đếm ngược 4 → 0).
- Cuối cùng: Hoàn tiền 🟠 → Trả hàng 🟠 → **CANCELLED**. Thanh toán: đúng **1** dòng hoàn tiền.

> **Kết luận:** Bước bù lỗi thì **không bỏ dở**: việc còn chờ được lưu trong DB, Order tự thử lại tới khi xong, mỗi việc **đúng 1 lần** (nhờ op_id cố định).

## 7. F6 · Order → *Sập sau khi Payment thu tiền* ⭐
**Làm:** Admin → Order → **Sập sau khi Payment thu tiền** ×1 → Cài lỗi. Cửa hàng → Alice đặt 1 Tai nghe.
**Nhìn (lúc Order chết):**
- Admin: dòng Order **đỏ – ĐÃ TẮT**; danh sách đơn báo Order đang tắt.
- Thanh toán: **đã có** dòng thanh toán 100.000 → Payment đã thu, nhưng Order chưa kịp ghi kết quả.

**Làm tiếp:** Admin → Order → **Bật lại**.
**Nhìn:** Flow: 🔄 khởi động lại → resume → hỏi lại payment theo op_id → **SUCCEEDED** → Thu tiền 🟢 → Xác nhận 🟢 → **CONFIRMED**. Thanh toán vẫn **1** dòng.

> **Kết luận:** Trước mỗi lời gọi, Order **ghi intent (việc sắp làm + op_id) vào DB**. Sập rồi bật lại vẫn biết đang dở bước nào → hỏi lại → không mất đơn, không thu 2 lần.

## 8. F6b · Order → *Sập trước khi gọi thu tiền* (biến thể)
**Làm:** giống mục 7 nhưng chọn **Sập trước khi gọi thu tiền**. Đặt hàng → Order chết → **Bật lại** Order.
**Nhìn:**
- Thanh toán lúc Order chết: **chưa có** dòng nào (chưa kịp gọi).
- Flow sau khi bật lại: hỏi lại → **NOT_FOUND** → **gọi lại cùng op_id** → Thu tiền 🟢 → **CONFIRMED**.

> **Kết luận:** NOT_FOUND chỉ là "chưa thấy" → Order **gọi lại đúng op_id cũ**, an toàn vì Payment idempotent. So với F6: cùng một cơ chế resume xử lý được cả 2 khoảng hở.

## 9. Bonus · Inventory → *Trả hàng lỗi tạm thời*
⚠ Lỗi này **chỉ nổ khi đơn bị hủy** (bước bù trả hàng). Mua thành công thì không thấy gì.
**Làm:**
1. Admin → Inventory → **Trả hàng lỗi tạm thời** ×4 → Cài lỗi.
2. Admin → Payment → **Từ chối thanh toán** ×1 → Cài lỗi.
3. Cửa hàng → Alice đặt 1 Tai nghe.

**Nhìn:** Flow: Thu tiền 🔴 → **COMPENSATING** → Trả hàng 🟣 *503* lặp lại vài lần → Trả hàng 🟠 → **CANCELLED**. Kho: tai nghe về lại 10.

> **Kết luận:** Giống F5 nhưng ở Inventory: bước bù lỗi tạm thời vẫn được giữ lại và hoàn tất.

---

## 10. Chốt
- Admin: 2 nhãn **✔ Tiền khớp · ✔ Kho khớp** sau mọi tình huống.
- Terminal: `npm test` → **7/7 pass** (H0, F1–F3 bắt buộc + F4–F6). Evidence: `evidence/F4.md`, `F5.md`, `F6.md`.

> **Kết luận chung:** Saga không "atomic" như 2PC, nhưng nhờ **intent bền vững + operation ID cố định + bước bù + trạng thái RECOVERING / COMPENSATING**, hệ thống luôn về trạng thái đúng và tiền / kho luôn khớp.
