// /api/mexc/exchangeInfo
// Proxy GET requests to MEXC's public exchangeInfo REST endpoint.
// Same CORS-bypass rationale as /api/mexc/aggTrades.js — see that file for details.
//
// Only forwards "symbol", which is the only param the existing frontend sends
// (used to auto-detect PRICE_FILTER.tickSize for the current symbol).

const MEXC_URL = 'https://api.mexc.com/api/v3/exchangeInfo';
const UPSTREAM_TIMEOUT_MS = 6000;

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const symbolRaw = req.query ? req.query.symbol : undefined;
  const symbol = Array.isArray(symbolRaw) ? symbolRaw[0] : symbolRaw;

  if (!symbol) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'Missing required "symbol" parameter' });
    return;
  }

  const upstreamUrl = `${MEXC_URL}?symbol=${encodeURIComponent(symbol)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    const bodyText = await upstream.text();

    if (!upstream.ok) {
      console.error(`[api/mexc/exchangeInfo] upstream HTTP ${upstream.status} for ${upstreamUrl} — body: ${bodyText.slice(0, 500)}`);
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    res.status(upstream.status);
    res.send(bodyText);
  } catch (err) {
    const isTimeout = err && err.name === 'AbortError';
    console.error(`[api/mexc/exchangeInfo] proxy error for ${upstreamUrl}:`, isTimeout ? 'timeout' : err);
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({
      error: isTimeout ? 'Upstream MEXC request timed out' : 'Upstream MEXC request failed',
      detail: err && err.message ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
};
