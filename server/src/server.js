// Local HTTP server: receives hook events, keeps the site model, streams it to browsers (SSE),
// and serves the scene and the handover report. Listens on 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intake } from './intake.js';
import { createSite, apply, expireStale, publicView } from './site.js';
import { loadRules } from './trades.js';
import { UsageReader, transcriptAllowed, addUsage } from './usage.js';
import { renderReport } from './report.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(here, '..', 'web');
export const APP_ID = 'buildsite';
export const VERSION = '0.1.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};
const MAX_BODY = 128 * 1024;
const TICK_MS = 1500;
const TOKEN_GRACE_MS = 20000;

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

export async function startServer({ port = 0, preferredPort = null, idleMs = 0, onIdle = null, rules = loadRules(), now = () => Date.now() } = {}) {
  const site = createSite();
  const viewers = new Map(); // res -> project id it follows ('' = latest)
  const readers = new Map(); // project id -> UsageReader
  const baselines = new Map(); // `${project}#${building}` -> usage total when the prompt arrived
  let boundPort = 0;
  let lastActivity = now();

  const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`]);
  const allowedOrigins = () => new Set([...allowedHosts()].map((h) => `http://${h}`));

  const push = () => {
    for (const [res, follow] of viewers) res.write(`data: ${JSON.stringify(publicView(site, follow))}\n\n`);
  };

  const reply = (res, code, body, type = 'application/json; charset=utf-8', headers = {}) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const parts = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new Error('too large'));
          req.destroy();
        } else parts.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
      req.on('error', reject);
    });

  // ---- tokens ----
  async function refreshTokens(projectId) {
    const reader = readers.get(projectId);
    const p = site.projects[projectId];
    if (!reader || !p) return false;
    const changed = await reader.poll();
    const total = reader.total();
    if (!total) return false;
    p.tokens = total;
    for (const b of p.buildings) {
      const base = baselines.get(`${projectId}#${b.no}`);
      if (base && (b.status === 'construct' || now() - (b.endedAt ?? 0) < TOKEN_GRACE_MS)) b.tokens = addUsage(total, base, -1);
    }
    return changed;
  }

  async function onEvent(ev) {
    if (ev.transcript && transcriptAllowed(ev.transcript)) {
      const r = readers.get(ev.session);
      if (!r || r.file !== ev.transcript) readers.set(ev.session, new UsageReader(ev.transcript));
    }
    apply(site, ev, rules, now());
    if (ev.kind === 'UserPromptSubmit') {
      const reader = readers.get(ev.session);
      if (reader) {
        await reader.poll();
        const b = site.projects[ev.session]?.buildings.at(-1);
        if (b) baselines.set(`${ev.session}#${b.no}`, reader.total() ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
      }
    }
    push();
  }

  const tick = setInterval(async () => {
    let changed = expireStale(site, now());
    for (const [id, p] of Object.entries(site.projects)) {
      const b = p.buildings.at(-1);
      if (b && (b.status === 'construct' || now() - (b.endedAt ?? 0) < TOKEN_GRACE_MS)) {
        if (await refreshTokens(id)) changed = true;
      }
    }
    for (const key of baselines.keys()) {
      const [pid] = key.split('#');
      if (!site.projects[pid]) baselines.delete(key);
    }
    for (const id of readers.keys()) if (!site.projects[id]) readers.delete(id);
    if (changed) push();
    if (viewers.size) lastActivity = now();
    if (idleMs && onIdle && now() - lastActivity > idleMs) onIdle();
  }, TICK_MS);
  tick.unref();

  const heartbeat = setInterval(() => {
    for (const res of viewers.keys()) res.write(': ping\n\n');
  }, 15000);
  heartbeat.unref();

  async function serveFile(res, rel) {
    const file = path.resolve(WEB_DIR, '.' + rel);
    if (!file.startsWith(WEB_DIR + path.sep)) return reply(res, 404, 'not found', MIME['.txt']);
    try {
      const data = await fs.readFile(file);
      const cache = rel.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-store';
      reply(res, 200, data, MIME[path.extname(file)] ?? 'application/octet-stream', { 'Cache-Control': cache });
    } catch {
      reply(res, 404, 'not found', MIME['.txt']);
    }
  }

  const server = http.createServer(async (req, res) => {
    // DNS-rebinding guard: only answer requests addressed to this machine by name or loopback address.
    if (!allowedHosts().has(req.headers.host ?? '')) return reply(res, 421, { error: 'bad host' });
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname === '/event') {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins().has(origin)) return reply(res, 403, { error: 'bad origin' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return reply(res, 415, { error: 'json only' });
      let ev;
      try {
        ev = intake(JSON.parse(await readBody(req)));
      } catch {
        return reply(res, 400, { error: 'bad body' });
      }
      lastActivity = now();
      if (ev) await onEvent(ev);
      return reply(res, ev ? 202 : 204, ev ? { ok: true } : '');
    }

    if (req.method !== 'GET') return reply(res, 405, { error: 'method' });

    switch (url.pathname) {
      case '/health':
        return reply(res, 200, { app: APP_ID, version: VERSION, port: boundPort });
      case '/api/state':
        return reply(res, 200, publicView(site, url.searchParams.get('project')));
      case '/api/trades':
        return reply(res, 200, rules.trades);
      case '/events': {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const follow = url.searchParams.get('project') ?? '';
        viewers.set(res, follow);
        res.write(`data: ${JSON.stringify(publicView(site, follow))}\n\n`);
        req.on('close', () => viewers.delete(res));
        return;
      }
      case '/report': {
        const id = url.searchParams.get('project') || site.latest;
        const p = id && site.projects[id];
        if (!p) return reply(res, 404, '<p>ยังไม่มีโครงการ</p>', MIME['.html']);
        const view = publicView(site, id).projects[id];
        return reply(res, 200, renderReport(view, rules.trades, now()), MIME['.html']);
      }
      case '/':
        return serveFile(res, '/index.html');
      default:
        return serveFile(res, url.pathname);
    }
  });

  if (preferredPort) {
    try {
      boundPort = await listen(server, preferredPort);
    } catch {
      boundPort = await listen(server, port);
    }
  } else {
    boundPort = await listen(server, port);
  }

  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}/`,
    site,
    close: () =>
      new Promise((resolve) => {
        clearInterval(tick);
        clearInterval(heartbeat);
        for (const res of viewers.keys()) res.end();
        viewers.clear();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
