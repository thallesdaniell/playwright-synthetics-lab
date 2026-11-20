// App de exemplo para o lab de sintéticos. Sem dependências: só Node >= 18.
//
// Endpoints:
//   POST /auth/login     {username, password} -> {access_token, token_type, expires_in}
//   GET  /me             Bearer token -> {username, role}
//   GET  /admin/users    só papel "admin" (o usuário sintético deve receber 403)
//   GET  /health         liveness
//   POST /chaos          (CHAOS_ENABLED=true) {fail: "login"|"me"|null, latencyMs: n}
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT ?? 3000);
const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao';
const TOKEN_TTL = 3600;
const CHAOS_ENABLED = process.env.CHAOS_ENABLED === 'true';

// Usuários. O sintético tem papel próprio, sem acesso administrativo.
const users = new Map([
  [
    process.env.SYNTH_USER ?? 'synthetic-bot',
    { password: process.env.SYNTH_PASSWORD ?? 'synthetic-pass', role: 'synthetic' },
  ],
  [
    process.env.ADMIN_USER ?? 'admin',
    { password: process.env.ADMIN_PASSWORD ?? 'admin-pass', role: 'admin' },
  ],
]);

const chaos = { fail: null, latencyMs: 0 };

// ---------- JWT HS256 mínimo ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url');

function issueToken(username, role) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ sub: username, role, iat: now, exp: now + TOKEN_TTL }));
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

function verifyToken(token) {
  const [header, payload, sig] = (token ?? '').split('.');
  if (!header || !payload || !sig) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- HTTP helpers ----------
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e5) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve(null);
      }
    });
  });
}

function authenticate(req) {
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' ? verifyToken(token) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Rotas ----------
async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${pathname}`;

  if (route === 'GET /health') return send(res, 200, { status: 'ok' });

  if (route === 'POST /chaos') {
    if (!CHAOS_ENABLED) return send(res, 404, { error: 'not_found' });
    const body = (await readJson(req)) ?? {};
    chaos.fail = body.fail ?? null;
    chaos.latencyMs = Number(body.latencyMs ?? 0);
    console.log('chaos atualizado:', chaos);
    return send(res, 200, chaos);
  }

  if (chaos.latencyMs > 0) await sleep(chaos.latencyMs);

  if (route === 'POST /auth/login') {
    if (chaos.fail === 'login') return send(res, 503, { error: 'service_unavailable' });
    const body = await readJson(req);
    if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
      return send(res, 400, { error: 'username e password são obrigatórios' });
    }
    const user = users.get(body.username);
    if (!user || !safeEqual(user.password, body.password)) {
      return send(res, 401, { error: 'invalid_credentials' });
    }
    return send(res, 200, {
      access_token: issueToken(body.username, user.role),
      token_type: 'Bearer',
      expires_in: TOKEN_TTL,
    });
  }

  if (route === 'GET /me') {
    if (chaos.fail === 'me') return send(res, 500, { error: 'internal_error' });
    const claims = authenticate(req);
    if (!claims) return send(res, 401, { error: 'unauthorized' });
    return send(res, 200, { username: claims.sub, role: claims.role });
  }

  if (route === 'GET /admin/users') {
    const claims = authenticate(req);
    if (!claims) return send(res, 401, { error: 'unauthorized' });
    if (claims.role !== 'admin') return send(res, 403, { error: 'forbidden' });
    return send(res, 200, [...users].map(([username, u]) => ({ username, role: u.role })));
  }

  return send(res, 404, { error: 'not_found' });
}

http
  .createServer((req, res) => {
    const start = Date.now();
    handle(req, res)
      .catch((err) => {
        console.error(err);
        if (!res.headersSent) send(res, 500, { error: 'internal_error' });
      })
      .finally(() => {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
      });
  })
  .listen(PORT, () => console.log(`app ouvindo na porta ${PORT} (chaos=${CHAOS_ENABLED})`));
