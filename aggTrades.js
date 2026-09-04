// /api/mexc/aggTrades
// Proxy GET requests to MEXC's public aggTrades REST endpoint.
//
// Why this exists: MEXC's public REST API does not send
// Access-Control-Allow-Origin headers, so a browser calling
// https://api.mexc.com/api/v3/aggTrades directly gets blocked by CORS.
// This function runs server-side (no CORS involved) and simply forwards
// the request/response, so the browser only ever talks to our own origin.
//
// Only forwards the query params the existing frontend actually sends:
// symbol (required), limit, fromId, startTime, endTime.

const MEXC_URL = 'https://api.mexc.com/api/v3/aggTrades';
const UPSTREAM_TIMEOUT_MS = 8000;
const FORWARDED_PARAMS = ['symbol', 'limit', 'fromId', 'startTime', 'endTime'];

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const qs = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const val = req.query ? req.query[key] : undefined;
    if (val !== undefined && val !== null && val !== '') {
      qs.set(key, Array.isArray(val) ? val[0] : val);
    }
  }

  if (!qs.get('symbol')) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Missing required "symbol" parameter' });
    return;
  }

  const upstreamUrl = `${MEXC_URL}?${qs.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    const bodyText = await upstream.text();

    if (!upstream.ok) {
      console.error(`[api/mexc/aggTrades] upstream HTTP ${upstream.status} for ${upstreamUrl} — body: ${bodyText.slice(0, 500)}`);
    }

    res.setHeader('Cache-Control', 'no-store'); // never cache live market data
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status);
    res.send(bodyText);
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    console.error(`[api/mexc/aggTrades] proxy error for ${upstreamUrl}:`, isTimeout ? 'timeout' : err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: isTimeout ? 'Upstream MEXC request timed out' : 'Upstream MEXC request failed',
      detail: err && err.message ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
};
