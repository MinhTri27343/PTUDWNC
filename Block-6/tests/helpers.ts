import request from 'supertest';
import { createApp } from '../src/app.js';
import { issueToken } from '../src/auth.js';
import type { Version } from '../src/types.js';
export function fixture() {
  const lab = createApp();
  return { ...lab,
    token: (id: string) => issueToken(id, lab.secret),
    async send(version: Version, method: string, path: string, user: string | null, body?: object, headers: Record<string,string> = {}) {
      const req = (request(lab.app) as any)[method.toLowerCase()](`/api/${version}${path}`);
      if (user) req.set('Authorization', `Bearer ${await issueToken(user, lab.secret)}`);
      for (const [key, value] of Object.entries(headers)) req.set(key, value);
      if (body !== undefined) req.send(body);
      return req;
    },
  };
}
export type Lab = ReturnType<typeof fixture>;
