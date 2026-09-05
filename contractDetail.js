// /api/mexc/contractDetail
// Proxy GET requests to MEXC FUTURES' public "contract detail" REST endpoint.
//
// Why this exists: MEXC Futures reports trade/kline "volume" (field "v"/"vol") as a NUMBER OF
// CONTRACTS, not as the underlying coin quantity. Each contract represents a fixed amount of the
// base asset ("contractSize", e.g. 0.0001 BTC per contract for BTC_USDT — the exact number is
// per-symbol and can change, so it must be read from the exchange, never hardcoded). Without this
// multiplier, any $ notional computed as price × v is wrong by a factor of 1/contractSize — this
// is exactly what was making the footprint's $ numbers look absurd (e.g. "$1000.00M" on a single
// M1 price cell). Same CORS-bypass rationale as the other /api/mexc/* proxies.

const CANDIDATE_BASES = [
  'https://contract.mexc.com/api/v1/contract/detail',
  'https://api.mexc.com/api/v1/contract/detail',
];
const UPSTREAM_TIMEOUT_MS = 6000;

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

  let lastError = null;
  for (const base of CANDIDATE_BASES) {
    // MEXC's contract/detail endpoint takes symbol as a query param (unlike deals/kline, which
    // take it as a path segment) and returns a single object (not an array) when "symbol" is set.
    const upstreamUrl = `${base}?symbol=${encodeURIComponent(symbolVal)}`;
    try {
      const result = await fetchWithTimeout(upstreamUrl);
      if (result.ok) {
        res.setHeader('Cache-Control', 'no-store'); // contract specs rarely change, but never serve stale on error
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(result.text);
        return;
      }
      lastError = `HTTP ${result.status} from ${upstreamUrl} — body: ${result.text.slice(0, 300)}`;
      console.error(`[api/mexc/contractDetail] ${lastError}`);
    } catch (err) {
      const isTimeout = err && err.name === 'AbortError';
      lastError = `${isTimeout ? 'timeout' : (err && err.message)} for ${upstreamUrl}`;
      console.error(`[api/mexc/contractDetail] proxy error: ${lastError}`);
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(502).json({ error: 'Upstream MEXC futures contract-detail request failed on all known base domains', detail: lastError });
};
