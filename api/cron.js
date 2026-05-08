const MONITORED_SERVICES = require("../public/services");
const REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_INTERVAL_MINUTES = 14;

function getIntervalMinutes(service) {
  return service.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
}

function getMinuteStamp(date = new Date()) {
  return Math.floor(date.getTime() / 60000);
}

function getServiceOffset(service, intervalMinutes) {
  const key = `${service.project}:${service.name}:${service.url}`;
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }

  return hash % intervalMinutes;
}

function isServiceDue(service, minuteStamp) {
  const intervalMinutes = getIntervalMinutes(service);
  const offset = getServiceOffset(service, intervalMinutes);

  return minuteStamp % intervalMinutes === offset;
}

function json(res, statusCode, body) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body, null, 2));
}

async function pingService(service) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(service.url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "vercel-pinger/1.0"
      }
    });

    const latencyMs = Date.now() - startedAt;

    return {
      project: service.project,
      name: service.name,
      url: service.url,
      intervalMinutes: getIntervalMinutes(service),
      ok: response.ok,
      status: response.status,
      latencyMs,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      project: service.project,
      name: service.name,
      url: service.url,
      intervalMinutes: getIntervalMinutes(service),
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error.name === "AbortError" ? "Request timed out" : error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const startedAt = Date.now();
  const minuteStamp = getMinuteStamp();
  const services = MONITORED_SERVICES.filter((service) => isServiceDue(service, minuteStamp));
  const results = await Promise.all(services.map(pingService));

  for (const result of results) {
    const status = result.status ?? "ERR";
    const message = result.error ? ` error=${result.error}` : "";
    console.log(
      `[${result.timestamp}] ${result.project} / ${result.name} ${result.url} status=${status} latency=${result.latencyMs}ms ok=${result.ok}${message}`
    );
  }

  json(res, 200, {
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    configuredCount: MONITORED_SERVICES.length,
    count: results.length,
    skippedCount: MONITORED_SERVICES.length - services.length,
    results
  });
};
