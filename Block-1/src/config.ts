import path from 'node:path';

// Đọc .env nếu có (Node >= 20.12). Không có file thì dùng giá trị mặc định.
try {
  process.loadEnvFile();
} catch {
  // không có .env — bỏ qua
}

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: path.resolve(ROOT_DIR, process.env.DB_PATH ?? './data/cart.db'),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  jwtExpiresIn: Number(process.env.JWT_EXPIRES_IN ?? 3600),
  specPath: path.join(ROOT_DIR, 'openapi', 'openapi.yaml'),
  migrationsDir: path.join(ROOT_DIR, 'migrations'),
};
