// /api/mexc/contractDeals
// Proxy GET requests to MEXC FUTURES' public "recent trades" REST endpoint.
// Used ONLY to seed the footprint of the very first live candle right when the page loads
// (so the chart isn't completely empty of buy/sell data for a few seconds while the WebSocket
// connects) — NOT for historical backfill, since this endpoint has no time range params at all
// and only ever returns the most recent trades (max 100).

const CANDIDATE_BASES = [
  'https://contract.mexc.com/api/v1/contract/deals',
  'https://api.mexc.com/api/v1/contract/deals',
];
const UPSTREAM_TIMEOUT_MS = 8000;

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
  if (!/^[A-Z0-9]+_[A-Z0-9]+$/.test(symbolVal)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Invalid "symbol" — futures symbols must look like BTC_USDT' });
    return;
  }
  const limitRaw = req.query && req.query.limit;
  const limit = Math.max(1, Math.min(100, parseInt(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw, 10) || 100));

  let lastError = null;
  for (const base of CANDIDATE_BASES) {
    const upstreamUrl = `${base}/${encodeURIComponent(symbolVal)}?limit=${limit}`;
    try {
      const result = await fetchWithTimeout(upstreamUrl);
      if (result.ok) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(result.text);
        return;
      }
      lastError = `HTTP ${result.status} from ${upstreamUrl} — body: ${result.text.slice(0, 300)}`;
      console.error(`[api/mexc/contractDeals] ${lastError}`);
    } catch (err) {
      const isTimeout = err && err.name === 'AbortError';
      lastError = `${isTimeout ? 'timeout' : (err && err.message)} for ${upstreamUrl}`;
      console.error(`[api/mexc/contractDeals] proxy error: ${lastError}`);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(502).json({ error: 'Upstream MEXC futures deals request failed on all known base domains', detail: lastError });
};
