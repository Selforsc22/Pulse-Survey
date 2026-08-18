// Squeak Easy Worker — accepts scores, blocks floods, returns averages.
// This file is the trust boundary. None of the validation below has a client-side
// twin that can be relied on; the page's localStorage check is a courtesy only.

/*
  ponytail: the known-ID list is hardcoded. Regenerate it whenever places.json
  changes, with:
    node -e "console.log(JSON.stringify(require('./places.json').map(p=>p.id),null,2))"
  Upgrade path is a `places` table in D1 and a FOREIGN KEY on ratings.place_id.
*/
const PLACE_IDS = [
  'the-curd-shack-cedarburg',
  'golden-basket-milwaukee',
  'fry-daddys-waukesha'
];

const MAX_BODY_BYTES = 1024;
const DAY_SECONDS = 24 * 60 * 60;
const PER_PLACE_LIMIT = 1;   // 1 rating per place per IP per 24h
const PER_IP_LIMIT = 15;     // 15 ratings per IP per 24h across all places

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (url.pathname !== '/scores') {
      return json({ error: 'not found' }, 404, origin);
    }

    try {
      if (request.method === 'GET') return await handleGet(env, origin);
      if (request.method === 'POST') return await handlePost(request, env, origin);
    } catch {
      return json({ error: 'server error' }, 500, origin);
    }

    return json({ error: 'method not allowed' }, 405, origin);
  }
};

/* --------------------------------------------------------------- responses */

function corsHeaders(origin) {
  return {
    // Only the GitHub Pages origin. Never "*".
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(body, status, origin, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
      ...extraHeaders
    }
  });
}

/* --------------------------------------------------------------- GET /scores */

async function handleGet(env, origin) {
  const { results } = await env.DB.prepare(
    `SELECT place_id, AVG(score) AS avg, COUNT(*) AS count
       FROM ratings
      GROUP BY place_id`
  ).all();

  const scores = {};
  for (const row of results || []) {
    scores[row.place_id] = {
      // One decimal is all the page shows; sending more is noise.
      avg: Math.round(Number(row.avg) * 10) / 10,
      count: Number(row.count)
    };
  }

  return json(scores, 200, origin, { 'Cache-Control': 'public, max-age=60' });
}

/* -------------------------------------------------------------- POST /scores */

async function handlePost(request, env, origin) {
  // Size guard runs first because the body has to be read before anything else
  // can inspect it. The spec lists it fourth; the checks below keep that order.
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return json({ error: 'body too large' }, 413, origin);
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return json({ error: 'body too large' }, 413, origin);
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad json' }, 400, origin);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'bad body' }, 400, origin);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';

  // 1. Turnstile.
  const passed = await verifyTurnstile(body.turnstileToken, env.TURNSTILE_SECRET, ip);
  if (!passed) return json({ error: 'challenge failed' }, 403, origin);

  // 2. Known place ID.
  const placeId = typeof body.placeId === 'string' ? body.placeId : '';
  if (!PLACE_IDS.includes(placeId)) {
    return json({ error: 'unknown place' }, 400, origin);
  }

  // 3. Integer 1-5.
  const score = body.score;
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return json({ error: 'bad score' }, 400, origin);
  }

  // Raw IP is never stored and never returned.
  const ipHash = await sha256Hex(ip + (env.SALT || ''));
  const now = Math.floor(Date.now() / 1000);
  const since = now - DAY_SECONDS;

  // Both rate limits in one SELECT COUNT(*).
  const limits = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN place_id = ?1 THEN 1 ELSE 0 END), 0) AS for_place
       FROM ratings
      WHERE ip_hash = ?2 AND created_at > ?3`
  ).bind(placeId, ipHash, since).first();

  if (Number(limits?.for_place || 0) >= PER_PLACE_LIMIT) {
    return json({ error: 'already rated' }, 409, origin);
  }
  if (Number(limits?.total || 0) >= PER_IP_LIMIT) {
    return json({ error: 'rate limited' }, 429, origin);
  }

  await env.DB.prepare(
    `INSERT INTO ratings (place_id, score, ip_hash, created_at) VALUES (?1, ?2, ?3, ?4)`
  ).bind(placeId, score, ipHash, now).run();

  const updated = await env.DB.prepare(
    `SELECT AVG(score) AS avg, COUNT(*) AS count FROM ratings WHERE place_id = ?1`
  ).bind(placeId).first();

  return json({
    avg: Math.round(Number(updated.avg) * 10) / 10,
    count: Number(updated.count)
  }, 200, origin);
}

/* ------------------------------------------------------------------ helpers */

async function verifyTurnstile(token, secret, ip) {
  if (!secret) return false;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    { method: 'POST', body: form }
  );
  if (!response.ok) return false;

  const outcome = await response.json();
  return outcome.success === true;
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
