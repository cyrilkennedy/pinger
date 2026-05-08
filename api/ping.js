// Proxy endpoint — the frontend calls this to avoid CORS restrictions.
// GET /api/ping?url=https://example.com
// Returns { ok, status, latencyMs, timestamp }

const REQUEST_TIMEOUT_MS = 12000;

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const { url } = require("url").parse(req.url, true).query;

  if (!url) {
    json(res, 400, { error: "Missing 'url' query parameter" });
    return;
  }

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      json(res, 400, { error: "Only http/https URLs are allowed" });
      return;
    }
  } catch {
    json(res, 400, { error: "Invalid URL" });
    return;
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "vercel-pinger/1.0" }
    });

    json(res, 200, {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    json(res, 200, {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    clearTimeout(timeout);
  }
};
