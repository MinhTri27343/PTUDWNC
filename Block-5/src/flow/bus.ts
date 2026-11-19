import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { Router as makeRouter } from 'express';
import { config } from '../config.js';
import { addLogSink, type LogEntry } from '../util.js';
import { describeAuthorization, redactLocation, redactObject, redactQuery } from './redact.js';

export type Service = 'as' | 'api' | 'taxi';

export interface FlowRecord {
  id: string;
  service: Service;
  kind: 'http' | 'note';
  /** epoch milliseconds with sub-ms precision; comparable across the three processes (same machine) */
  t: number;
  // http
  actor?: string;
  method?: string;
  path?: string;
  query?: unknown;
  req?: { authorization?: unknown; body?: unknown };
  pending?: boolean;
  status?: number;
  durationMs?: number;
  res?: { location?: string; page?: string; body?: unknown };
  // note (a decision the service logged: "pkce_check", "code_issued", "token_rejected"...)
  event?: string;
  level?: 'ok' | 'reject' | 'info';
  data?: unknown;
}

const now = (): number => performance.timeOrigin + performance.now();

/** In-process ring buffer + Server-Sent-Events fan-out of what this service really did. */
export class FlowBus {
  private records: FlowRecord[] = [];
  private clients = new Set<Response>();
  private seq = 0;

  constructor(readonly service: Service) {
    addLogSink((entry) => this.note(entry));
  }

  nextId(): string {
    return `${this.service}-${++this.seq}`;
  }

  /** Forget everything seen so far (Flow UI "Reset demo"). */
  clear(): void {
    this.records = [];
  }

  push(rec: FlowRecord): void {
    this.records.push(rec);
    if (this.records.length > 600) this.records.shift();
    this.broadcast(rec);
  }

  update(rec: FlowRecord): void {
    this.broadcast(rec);
  }

  note(entry: LogEntry): void {
    const { ts: _ts, component: _component, event, ...data } = entry;
    const level = /rejected|failed|unlinked|denied|revoked|replayed|reuse/.test(event)
      ? 'reject'
      : /issued|linked|refreshed|ok|applied|verified|check|charged/.test(event)
        ? 'ok'
        : 'info';
    this.push({ id: this.nextId(), service: this.service, kind: 'note', t: now(), event, level, data: redactObject(data) });
  }

  stream(req: Request, res: Response): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    for (const rec of this.records) res.write(`data: ${JSON.stringify(rec)}\n\n`);
    this.clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      this.clients.delete(res);
    });
  }

  private broadcast(rec: FlowRecord): void {
    const data = `data: ${JSON.stringify(rec)}\n\n`;
    for (const c of this.clients) c.write(data);
  }
}

/** Lab-only CORS so the Flow UI (another origin) can read responses and open the event stream. */
export function corsFor(origin: string, opts: { credentials?: boolean } = {}): RequestHandler {
  return (req, res, next) => {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Flow-Actor');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Idempotent-Replayed');
    if (opts.credentials) res.set('Access-Control-Allow-Credentials', 'true');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  };
}

/**
 * `/_flow/info`, `/_flow/stream` and `/_flow/reset` — mount before sessions/body parsers.
 * `onReset` returns the service to its freshly seeded state so the demo can start over without restarts.
 */
export function flowRouter(bus: FlowBus, onReset?: () => void): Router {
  const r = makeRouter();
  r.use('/_flow', corsFor(config.flowUrl));
  r.get('/_flow/info', (_req, res) => {
    res.json({ service: bus.service });
  });
  r.post('/_flow/reset', (_req, res) => {
    onReset?.();
    bus.clear();
    res.json({ service: bus.service, reset: true });
  });
  r.get('/_flow/stream', (req, res) => bus.stream(req, res));
  return r;
}

const SKIP = (path: string): boolean =>
  path.startsWith('/_flow') || path.startsWith('/docs') || path === '/openapi.json' || path === '/debug/counter' || path === '/api/state' || path === '/favicon.ico'; // polling noise, not part of the flow

/** Records every inbound HTTP exchange of this service (redacted). Mount AFTER the body parsers. */
export function flowTap(bus: FlowBus): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const url = new URL(req.originalUrl, 'http://x');
    if (SKIP(url.pathname) || req.method === 'OPTIONS') {
      next();
      return;
    }
    const started = now();
    const rec: FlowRecord = {
      id: bus.nextId(),
      service: bus.service,
      kind: 'http',
      t: started,
      actor: req.get('x-flow-actor') ?? 'browser',
      method: req.method,
      path: url.pathname,
      query: url.search ? redactQuery(url.searchParams) : undefined,
      req: {
        authorization: describeAuthorization(req.get('authorization')),
        body: req.body && Object.keys(req.body).length > 0 ? redactObject(req.body) : undefined,
      },
      pending: true,
    };
    bus.push(rec);

    let jsonBody: unknown;
    let page: string | undefined;
    const origJson = res.json.bind(res);
    res.json = (body: unknown) => {
      jsonBody = body;
      return origJson(body);
    };
    const origSend = res.send.bind(res);
    res.send = (body?: unknown) => {
      if (typeof body === 'string' && /<h1/i.test(body)) page = /<h1[^>]*>([^<]*)</i.exec(body)?.[1];
      return origSend(body as never);
    };

    res.on('finish', () => {
      const location = res.getHeader('location');
      rec.pending = false;
      rec.status = res.statusCode;
      rec.durationMs = Math.round(now() - started);
      rec.res = {
        location: typeof location === 'string' ? redactLocation(location, `http://localhost`) : undefined,
        page,
        body: jsonBody === undefined ? undefined : redactObject(jsonBody),
      };
      bus.update(rec);
    });
    next();
  };
}
