import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import express, { type Express } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { parse } from 'yaml';
import { bearerAuthHandler } from './auth';
import { config } from './config';
import { errorHandler, notFoundHandler } from './errors';
import { createLogger } from './logger';
import { authRouter } from './routes/auth';
import { cartsRouter } from './routes/carts';
import { productsRouter } from './routes/products';

export interface AppOptions {
  logger?: Logger;
  /** Bật đối chiếu response thật với spec (dùng trong test / evidence). */
  validateResponses?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createApp({ logger = createLogger(), validateResponses = false }: AppOptions = {}): Express {
  const app = express();

  // 1. request_id cho mọi request → header X-Request-Id, error body và dòng log.
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && UUID_RE.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
    }),
  );

  // 2. Body JSON (JSON hỏng → errorHandler đổi thành 400 VALIDATION_ERROR).
  app.use(express.json({ limit: '100kb' }));

  // 3. Swagger UI + file spec gốc, đặt trước validator nên không bị validate.
  const specFile = fs.readFileSync(config.specPath, 'utf8');
  const spec = parse(specFile) as Record<string, unknown>;
  spec.servers = [{ url: '/' }]; // "Try it out" gọi đúng host/port đang chạy
  app.get('/openapi.yaml', (_req, res) => {
    res.type('application/yaml').send(specFile);
  });
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, { swaggerOptions: { persistAuthorization: true } }));

  // 4. Validator đọc thẳng openapi.yaml: security (401) → request (400) → [handler] → response (khi bật).
  app.use(
    OpenApiValidator.middleware({
      apiSpec: config.specPath,
      validateRequests: { allowUnknownQueryParameters: false },
      validateResponses,
      validateFormats: true,
      ajvFormats: { mode: 'full' },
      validateSecurity: { handlers: { bearerAuth: async (req) => bearerAuthHandler(req) } },
    }),
  );

  // 5. Routes
  app.use(authRouter, productsRouter, cartsRouter);

  // 6-7. 404 + error handler chung
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
