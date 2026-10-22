import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { ROOT } from './db.js';

/** Serve `openapi/<file>` as Swagger UI at /docs, with the server URL replaced for this run. */
export function mountDocs(app: Express, file: string, serverUrl: string): void {
  const doc = YAML.parse(fs.readFileSync(path.join(ROOT, 'openapi', file), 'utf8')) as {
    servers?: { url: string }[];
  };
  doc.servers = [{ url: serverUrl }];
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(doc, { swaggerOptions: { persistAuthorization: true } }));
  app.get('/openapi.json', (_req, res) => {
    res.json(doc);
  });
}
