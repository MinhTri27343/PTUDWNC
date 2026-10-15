import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Mỗi test dùng file SQLite tạm riêng; chạy tuần tự cho đơn giản và ổn định (config/db là singleton).
    fileParallelism: false,
    testTimeout: 15000,
  },
});
