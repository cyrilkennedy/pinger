/* ═══════════════════════════════════════════════════════
   PINGER — Status Page Application
   ═══════════════════════════════════════════════════════ */

const REFRESH_MS = 60000;
const DEFAULT_SLOW_THRESHOLD_MS = 1000;
const LOG_LIMIT = 20;
const LOG_PREFIX = "pinger:logs:";

// Detect environment: if hosted on Vercel, use the proxy endpoint.
// Locally, fall back to direct fetch (which may hit CORS).
const API_BASE = detectApiBase();

function detectApiBase() {
  const host = window.location.hostname;
  // On Vercel or any non-localhost domain, use relative /api/ping
  if (host !== "localhost" && host !== "127.0.0.1") {
    return "/api/ping";
  }
  // Locally, we won't have the serverless function — use direct fetch.
  return null;
}

/* ─── DOM references ───────────────────────────────── */
const groupsEl = document.querySelector("#statusGroups");
const summaryTextEl = document.querySelector("#summaryText");
const lastCheckedEl = document.querySelector("#lastChecked");
const nextRefreshEl = document.querySelector("#nextRefresh");
const summaryBadgesEl = document.querySelector("#summaryBadges");
const serviceCountEl = document.querySelector("#serviceCount");
const progressFill = document.querySelector("#progressFill");

/* ─── State ────────────────────────────────────────── */
let services = [];
let currentRun = 0;
let latestResults = new Map();
let countdownInterval = null;

/* ─── Helpers ──────────────────────────────────────── */
function serviceKey(service) {
  return `${service.project || ""}:${service.name || ""}:${service.url}`;
}

function logKey(service) {
  return `${LOG_PREFIX}${serviceKey(service)}`;
}

function loadLogs(service) {
  try {
    const logs = JSON.parse(localStorage.getItem(logKey(service)) || "[]");
    return Array.isArray(logs) ? logs.slice(0, LOG_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveLogs(service, logs) {
  try {
    localStorage.setItem(logKey(service), JSON.stringify(logs.slice(0, LOG_LIMIT)));
  } catch {
    // Ignore storage failures in restricted browsers.
  }
}

function groupByProject(items) {
  return items.reduce((groups, service) => {
    const project = service.project || "Services";
    groups.set(project, [...(groups.get(project) || []), service]);
    return groups;
  }, new Map());
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function getStatus(result, service) {
  if (!result) return { label: "Checking", className: "checking", icon: "⏳" };
  if (!result.ok) return { label: "Down", className: "down", icon: "❌" };

  const threshold = service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS;
  if (result.latencyMs > threshold) return { label: "Slow", className: "slow", icon: "⚠️" };

  return { label: "Up", className: "up", icon: "✅" };
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value = "") {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

/* ─── Logging ──────────────────────────────────────── */
function buildLogEntry(service, result) {
  const status = getStatus(result, service);
  const code = result.status ? `HTTP ${result.status}` : result.note || "No status";
  const detail = result.error || result.note || "";

  return {
    timestamp: new Date().toISOString(),
    label: status.label,
    className: status.className,
    code,
    latency: formatLatency(result.latencyMs),
    detail
  };
}

function appendLog(service, result) {
  const logs = [buildLogEntry(service, result), ...loadLogs(service)].slice(0, LOG_LIMIT);
  saveLogs(service, logs);
}

function renderLogs(service) {
  const logs = loadLogs(service);

  if (!logs.length) {
    return '<li class="log-empty">No logs yet.</li>';
  }

  return logs
    .map((entry) => {
      const time = new Date(entry.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      const detail = entry.detail ? `<span>${escapeHtml(entry.detail)}</span>` : "";

      return `
      <li class="log-row">
        <span class="log-dot ${escapeAttribute(entry.className)}"></span>
        <span class="log-time">${escapeHtml(time)}</span>
        <span class="log-status">${escapeHtml(entry.label)}</span>
        <span>${escapeHtml(entry.code)}</span>
        <span>${escapeHtml(entry.latency)}</span>
        ${detail}
      </li>`;
    })
    .join("");
}

/* ─── Ping (with proxy support) ────────────────────── */
async function ping(service, runId) {
  const startedAt = performance.now();

  // If we have the proxy API available, use it to avoid CORS
  if (API_BASE) {
    try {
      const proxyUrl = `${API_BASE}?url=${encodeURIComponent(service.url)}`;
      const response = await fetch(proxyUrl, {
        method: "GET",
        cache: "no-store"
      });
      const data = await response.json();

      return {
        key: serviceKey(service),
        ok: data.ok,
        status: data.status,
        note: data.error ? data.error : undefined,
        error: data.error || undefined,
        latencyMs: data.latencyMs,
        slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS
      };
    } catch (error) {
      return {
        key: serviceKey(service),
        ok: false,
        status: null,
        error: error.message || "Proxy request failed",
        latencyMs: performance.now() - startedAt,
        slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS
      };
    }
  }

  // Fallback: direct fetch (may be blocked by CORS in browsers)
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(service.url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });

    return {
      key: serviceKey(service),
      ok: response.ok,
      status: response.status,
      latencyMs: performance.now() - startedAt,
      slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS
    };
  } catch (error) {
    if (runId !== currentRun) return null;

    // no-cors fallback — we can't read the response but we know it's reachable
    try {
      await fetch(service.url, {
        method: "GET",
        cache: "no-store",
        mode: "no-cors",
        signal: controller.signal
      });

      return {
        key: serviceKey(service),
        ok: true,
        status: 0,
        note: "Reachable (CORS blocked)",
        latencyMs: performance.now() - startedAt,
        slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS
      };
    } catch {
      return {
        key: serviceKey(service),
        ok: false,
        status: null,
        error: error.name === "AbortError" ? "Request timed out" : error.message || "Request failed",
        latencyMs: performance.now() - startedAt,
        slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS
      };
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

/* ─── Render ───────────────────────────────────────── */
function render(results = new Map()) {
  if (!services.length) {
    groupsEl.innerHTML = '<div class="empty">No services configured. Add URLs to <code>services.js</code>.</div>';
    summaryTextEl.textContent = "No services";
    return;
  }

  const groups = groupByProject(services);
  const html = [...groups.entries()]
    .map(([project, items]) => {
      const cards = items
        .map((service) => {
          const result = results.get(serviceKey(service));
          const status = getStatus(result, service);
          const code = result?.status ? `HTTP ${result.status}` : result?.note || "Waiting…";
          const latency = result ? formatLatency(result.latencyMs) : "—";
          const key = serviceKey(service);

          return `
          <article class="service" data-service-key="${escapeAttribute(key)}">
            <div class="service-summary">
              <div class="service-main">
                <h3 class="service-name">${escapeHtml(service.name)}</h3>
                <a class="service-url" href="${escapeAttribute(service.url)}" target="_blank" rel="noreferrer">${escapeHtml(service.url)}</a>
                <div class="meta">
                  <span class="meta-item">${escapeHtml(code)}</span>
                  <span class="meta-item"><span class="dot"></span> ${escapeHtml(latency)}</span>
                </div>
              </div>
              <span class="status ${status.className}">
                <span class="status-icon">${status.icon}</span>
                ${status.label}
              </span>
            </div>
            <div class="service-logs">
              <div class="log-header">
                <span>Ping History</span>
                <button class="clear-logs" type="button" data-clear-key="${escapeAttribute(key)}">Clear</button>
              </div>
              <ul class="log-list">${renderLogs(service)}</ul>
            </div>
          </article>`;
        })
        .join("");

      return `
      <section class="project">
        <div class="project-header">
          <h2>${escapeHtml(project)}</h2>
          <span class="project-count">${items.length} ${items.length === 1 ? "service" : "services"}</span>
        </div>
        <div class="services">${cards}</div>
      </section>`;
    })
    .join("");

  groupsEl.innerHTML = html;
  bindLogButtons();

  // Summary badges
  const values = [...results.values()];
  const up = values.filter((r) => r.ok && r.latencyMs <= (r.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS)).length;
  const slow = values.filter((r) => r.ok && r.latencyMs > (r.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS)).length;
  const down = values.filter((r) => !r.ok).length;

  summaryTextEl.textContent = values.length ? `${values.length} checked` : "Checking…";

  let badgesHtml = "";
  if (up > 0) badgesHtml += `<span class="badge badge--up">✅ ${up} up</span>`;
  if (slow > 0) badgesHtml += `<span class="badge badge--slow">⚠️ ${slow} slow</span>`;
  if (down > 0) badgesHtml += `<span class="badge badge--down">❌ ${down} down</span>`;
  summaryBadgesEl.innerHTML = badgesHtml;
}

function bindLogButtons() {
  for (const button of groupsEl.querySelectorAll("[data-clear-key]")) {
    button.addEventListener("click", () => {
      const service = services.find((s) => serviceKey(s) === button.dataset.clearKey);
      if (!service) return;
      localStorage.removeItem(logKey(service));
      render(latestResults);
    });
  }
}

/* ─── Countdown / Progress Bar ─────────────────────── */
function startCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  let remaining = REFRESH_MS / 1000;
  const total = REFRESH_MS / 1000;

  progressFill.style.transition = "none";
  progressFill.style.width = "100%";

  // Force reflow so the browser registers the reset
  void progressFill.offsetWidth;

  progressFill.style.transition = `width ${total}s linear`;
  progressFill.style.width = "0%";

  nextRefreshEl.textContent = `${remaining}s`;

  countdownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      clearInterval(countdownInterval);
    }
    nextRefreshEl.textContent = `${remaining}s`;
  }, 1000);
}

/* ─── Refresh Cycle ────────────────────────────────── */
async function refresh() {
  const runId = ++currentRun;
  render();

  const settled = await Promise.all(services.map((service) => ping(service, runId)));
  if (runId !== currentRun) return;

  const results = new Map();
  for (const result of settled) {
    if (result) results.set(result.key, result);
  }

  for (const service of services) {
    const result = results.get(serviceKey(service));
    if (result) appendLog(service, result);
  }

  latestResults = results;
  render(results);

  const now = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  lastCheckedEl.textContent = now;
  startCountdown();
}

/* ─── Boot ─────────────────────────────────────────── */
async function boot() {
  try {
    services = window.MONITORED_SERVICES || [];
    serviceCountEl.textContent = services.length;
    render();
    await refresh();
    window.setInterval(refresh, REFRESH_MS);
  } catch (error) {
    groupsEl.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    summaryTextEl.textContent = "Unable to load";
  }
}

boot();
