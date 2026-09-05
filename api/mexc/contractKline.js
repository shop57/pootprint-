// /api/mexc/contractKline
// Proxy GET requests to MEXC FUTURES' public candlestick (kline) REST endpoint.
//
// Why this exists: same CORS reason as aggTrades.js — MEXC's public REST does not send
// Access-Control-Allow-Origin, so the browser cannot call it directly.
//
// Why kline instead of aggTrades for history: MEXC Futures' public trade endpoint
// (/api/v1/contract/deals/{symbol}) ONLY returns the most recent up to 100 trades — it has
// NO startTime/endTime/pagination at all, so it is structurally impossible to reconstruct deep
// trade-level history from it. The kline endpoint, by contrast, returns official exchange
// candles — one row per interval, ALWAYS present (flat OHLC during quiet periods) — for up to
// 2000 points per request. Historical candle BODIES (open/high/low/close) are built from this
// endpoint; per-price-level buy/sell footprint is only available for LIVE candles going forward,
// built from the WebSocket deal stream (see the frontend for that half).
//
// MEXC has changed its Futures REST base domain at least once in its docs/changelog history
// (contract.mexc.com -> api.mexc.com). We try contract.mexc.com first (the long-standing,
// widely used domain across every third-party SDK) and fall back to api.mexc.com automatically
// if that fails, so this proxy keeps working even if MEXC finishes migrating the domain.

const CANDIDATE_BASES = [
  'https://contract.mexc.com/api/v1/contract/kline',
  'https://api.mexc.com/api/v1/contract/kline',
];
const UPSTREAM_TIMEOUT_MS = 8000;
const FORWARDED_PARAMS = ['interval', 'start', 'end'];
const VALID_INTERVALS = new Set(['Min1','Min5','Min15','Min30','Min60','Hour4','Hour8','Day1','Week1','Month1']);

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const symbol = req.query ? req.query.symbol : undefined;
  const symbolVal = Array.isArray(symbol) ? symbol[0] : symbol;
  if (!symbolVal) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Missing required "symbol" parameter' });
    return;
  }
  // Futures symbols use underscore notation (BTC_USDT), unlike spot (BTCUSDT).
  if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(symbolVal)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Invalid "symbol" — futures symbols must look like BTC_USDT' });
    return;
  }

  const interval = req.query && req.query.interval;
  if (interval && !VALID_INTERVALS.has(Array.isArray(interval) ? interval[0] : interval)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Invalid "interval"' });
    return;
  }

  const qs = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const val = req.query ? req.query[key] : undefined;
    if (val !== undefined && val !== null && val !== '') {
      qs.set(key, Array.isArray(val) ? val[0] : val);
    }
  }
  const qsStr = qs.toString();

  let lastError = null;
  for (const base of CANDIDATE_BASES) {
    const upstreamUrl = `${base}/${encodeURIComponent(symbolVal)}${qsStr ? '?' + qsStr : ''}`;
    try {
      const result = await fetchWithTimeout(upstreamUrl);
      if (result.ok) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(result.text);
        return;
      }
      lastError = `HTTP ${result.status} from ${upstreamUrl} — body: ${result.text.slice(0, 300)}`;
      console.error(`[api/mexc/contractKline] ${lastError}`);
      // fall through and try next candidate base domain
    } catch (err) {
      const isTimeout = err && err.name === 'AbortError';
      lastError = `${isTimeout ? 'timeout' : (err && err.message)} for ${upstreamUrl}`;
      console.error(`[api/mexc/contractKline] proxy error: ${lastError}`);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(502).json({ error: 'Upstream MEXC futures kline request failed on all known base domains', detail: lastError });
};
