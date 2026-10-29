# HTTP oracle — request thật đến các phiên bản

Các mã ở Starter/V1/V2/V3 phản ánh giới hạn cố ý của từng giai đoạn. Cột Đích là kết quả yêu cầu ở V4.

| Tình huống | Starter | V1 | V2 | V3 | V4 | Đích |
|---|---|---|---|---|---|---|
| 01 Anonymous đọc A1 | 401 | 401 | 401 | 401 | 401 | 401 |
| 02 Alice đọc A1 | 200 | 200 | 200 | 200 | 200 | 200 |
| 03 Alice đọc B1 (IDOR) | 200 | 403 | 403 | 403 | 403 | 403 |
| 04 Charlie đọc B1 | 200 | 200 | 200 | 200 | 200 | 200 |
| 05 Viewer sửa A1 | 200 | 200 | 403 | 403 | 403 | 403 |
| 06 Member xóa Alpha | 200 | 200 | 403 | 403 | 403 | 403 |
| 07 Member quản lý thành viên | 200 | 200 | 403 | 403 | 403 | 403 |
| 08 Owner xóa Alpha | 200 | 200 | 200 | 200 | 200 | 200 |
| 09 Owner quản lý thành viên | 200 | 200 | 200 | 200 | 200 | 200 |
| 10 Bob giả role Admin | 200 | 200 | 403 | 403 | 403 | 403 |
| 11 Member sửa task được giao Open | 200 | 200 | 200 | 200 | 200 | 200 |
| 12 Member sửa task chưa giao | 200 | 200 | 200 | 403 | 403 | 403 |
| 13 Member sửa task Closed | 200 | 200 | 200 | 403 | 403 | 403 |
| 14 Member sửa task project khác | 200 | 200 | 403 | 403 | 403 | 403 |
| 15 Admin Alpha đọc A1 | 200 | 403 | 200 | 200 | 200 | 200 |
| 16 Admin Alpha đọc B1 | 200 | 403 | 200 | 200 | 403 | 403 |
| 17 Admin giả X-Tenant-Id beta | 200 | 403 | 200 | 200 | 403 | 403 |
