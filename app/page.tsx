"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { monitoredServices, type MonitoredService } from "@/lib/services";

const DEFAULT_SLOW_THRESHOLD_MS = 1000;
const LOG_LIMIT = 20;
const LOG_PREFIX = "pinger:logs:";
const LAST_PING_PREFIX = "pinger:last-ping:";
const IN_FLIGHT_PREFIX = "pinger:in-flight:";
const PAUSED_PREFIX = "pinger:paused:";
const GLOBAL_PAUSED_KEY = "pinger:paused:global";
const IN_FLIGHT_TIMEOUT_MS = 30000;
const TICK_MS = 1000;

type BrowserPingResult = {
  key: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  slowThresholdMs: number;
  note?: string;
  error?: string;
};

type StatusInfo = {
  label: "Checking" | "Up" | "Slow" | "Down";
  className: "checking" | "up" | "slow" | "down";
};

type LogEntry = {
  timestamp: string;
  label: StatusInfo["label"];
  className: StatusInfo["className"];
  code: string;
  latency: string;
  detail: string;
};

function serviceKey(service: MonitoredService) {
  return `${service.project || ""}:${service.name || ""}:${service.url}`;
}

function logKey(service: MonitoredService) {
  return `${LOG_PREFIX}${serviceKey(service)}`;
}

function lastPingKey(service: MonitoredService) {
  return `${LAST_PING_PREFIX}${serviceKey(service)}`;
}

function inFlightKey(service: MonitoredService) {
  return `${IN_FLIGHT_PREFIX}${serviceKey(service)}`;
}

function pausedKey(service: MonitoredService) {
  return `${PAUSED_PREFIX}${serviceKey(service)}`;
}

function formatLatency(value: number) {
  if (!Number.isFinite(value)) return "No response";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
}

function formatDuration(ms: number) {
  if (ms <= 0) return "now";

  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function getStatus(result: BrowserPingResult | undefined, service: MonitoredService): StatusInfo {
  if (!result) return { label: "Checking", className: "checking" };
  if (!result.ok) return { label: "Down", className: "down" };

  const threshold = service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS;
  if (result.latencyMs > threshold) return { label: "Slow", className: "slow" };

  return { label: "Up", className: "up" };
}

function loadLogs(service: MonitoredService) {
  try {
    const logs = JSON.parse(localStorage.getItem(logKey(service)) || "[]");
    return Array.isArray(logs) ? (logs as LogEntry[]).slice(0, LOG_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveLogs(service: MonitoredService, logs: LogEntry[]) {
  try {
    localStorage.setItem(logKey(service), JSON.stringify(logs.slice(0, LOG_LIMIT)));
  } catch {
    // Private or restricted browsers can block storage; status checks should still work.
  }
}

function readStoredNumber(key: string) {
  if (typeof window === "undefined") return null;

  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function saveLastPingTime(service: MonitoredService, timestamp: number) {
  try {
    localStorage.setItem(lastPingKey(service), String(timestamp));
  } catch {
    // Timing memory is best-effort; the in-page scheduler still works.
  }
}

function loadLastPingTimes() {
  const times = new Map<string, number>();

  for (const service of monitoredServices) {
    const timestamp = readStoredNumber(lastPingKey(service));
    if (timestamp) times.set(serviceKey(service), timestamp);
  }

  return times;
}

function isGlobalPaused() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(GLOBAL_PAUSED_KEY) === "true";
}

function isServicePaused(service: MonitoredService) {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(pausedKey(service)) === "true";
}

function hasFreshInFlightLock(service: MonitoredService, timestamp: number) {
  const lockedAt = readStoredNumber(inFlightKey(service));
  return Boolean(lockedAt && timestamp - lockedAt < IN_FLIGHT_TIMEOUT_MS);
}

function lockService(service: MonitoredService, timestamp: number) {
  try {
    localStorage.setItem(inFlightKey(service), String(timestamp));
  } catch {
    // If storage is blocked, only this tab's in-memory run guard applies.
  }
}

function unlockService(service: MonitoredService) {
  try {
    localStorage.removeItem(inFlightKey(service));
  } catch {
    // Ignore storage failures.
  }
}

function buildLogEntry(service: MonitoredService, result: BrowserPingResult): LogEntry {
  const status = getStatus(result, service);
  const code = result.status ? `HTTP ${result.status}` : result.note || "No status";

  return {
    timestamp: new Date().toISOString(),
    label: status.label,
    className: status.className,
    code,
    latency: formatLatency(result.latencyMs),
    detail: result.error || result.note || ""
  };
}

async function ping(service: MonitoredService, runId: number, currentRun: () => number): Promise<BrowserPingResult | null> {
  const startedAt = performance.now();

  try {
    const response = await fetch(`/api/ping?url=${encodeURIComponent(service.url)}`, {
      method: "GET",
      cache: "no-store"
    });
    const data = await response.json();

    return {
      key: serviceKey(service),
      ok: Boolean(data.ok),
      status: data.status ?? null,
      latencyMs: Number(data.latencyMs ?? performance.now() - startedAt),
      slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS,
      error: data.error
    };
  } catch (error) {
    if (runId !== currentRun()) return null;

    return {
      key: serviceKey(service),
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Request failed",
      latencyMs: performance.now() - startedAt,
      slowThresholdMs: service.slowThresholdMs || DEFAULT_SLOW_THRESHOLD_MS
    };
  }
}

export default function StatusPage() {
  const [results, setResults] = useState<Map<string, BrowserPingResult>>(new Map());
  const [logsVersion, setLogsVersion] = useState(0);
  const [lastChecked, setLastChecked] = useState("Starting now");
  const [lastPingTimes, setLastPingTimes] = useState<Map<string, number>>(new Map());
  const [pausedVersion, setPausedVersion] = useState(0);
  const [globalPaused, setGlobalPaused] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const currentRun = useRef(0);
  const resultsRef = useRef(new Map<string, BrowserPingResult>());
  const lastPingTimesRef = useRef(new Map<string, number>());

  const groupedServices = useMemo(() => {
    return monitoredServices.reduce((groups, service) => {
      const project = service.project || "Services";
      groups.set(project, [...(groups.get(project) || []), service]);
      return groups;
    }, new Map<string, MonitoredService[]>());
  }, []);

  const refresh = useCallback(async (mode: "all" | "due" = "due") => {
    const timestamp = Date.now();
    if (isGlobalPaused()) return;

    const storedTimes = loadLastPingTimes();
    if (storedTimes.size) {
      lastPingTimesRef.current = new Map([...lastPingTimesRef.current, ...storedTimes]);
      setLastPingTimes(lastPingTimesRef.current);
    }

    const servicesToPing = monitoredServices.filter((service) => {
      if (isServicePaused(service)) return false;
      if (hasFreshInFlightLock(service, timestamp)) return false;
      if (mode === "all") return true;

      const key = serviceKey(service);
      const lastPingAt = lastPingTimesRef.current.get(key);
      const intervalMs = Math.max(1, service.intervalMinutes) * 60 * 1000;

      return !lastPingAt || timestamp - lastPingAt >= intervalMs;
    });

    if (!servicesToPing.length) return;

    const runId = currentRun.current + 1;
    currentRun.current = runId;
    for (const service of servicesToPing) {
      lockService(service, timestamp);
    }

    try {
      const settled = await Promise.all(servicesToPing.map((service) => ping(service, runId, () => currentRun.current)));
      if (runId !== currentRun.current) return;

      const nextResults = new Map(resultsRef.current);
      const nextPingTimes = new Map(lastPingTimesRef.current);

      for (const result of settled) {
        if (result) nextResults.set(result.key, result);
      }

      for (const service of servicesToPing) {
        const result = nextResults.get(serviceKey(service));
        if (!result) continue;

        saveLogs(service, [buildLogEntry(service, result), ...loadLogs(service)].slice(0, LOG_LIMIT));
        const completedAt = Date.now();
        saveLastPingTime(service, completedAt);
        nextPingTimes.set(serviceKey(service), completedAt);
      }

      lastPingTimesRef.current = nextPingTimes;
      resultsRef.current = nextResults;
      setResults(nextResults);
      setLastPingTimes(nextPingTimes);
      setLogsVersion((version) => version + 1);
      setLastChecked(`Checked ${new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      })}`);
    } finally {
      for (const service of servicesToPing) {
        unlockService(service);
      }
    }
  }, []);

  useEffect(() => {
    const storedTimes = loadLastPingTimes();
    lastPingTimesRef.current = storedTimes;
    setLastPingTimes(storedTimes);
    setGlobalPaused(isGlobalPaused());
    setPausedVersion((version) => version + 1);
    void refresh("due");
  }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh("due");
    }, TICK_MS);

    return () => window.clearInterval(timer);
  }, [refresh]);

  const summary = useMemo(() => {
    const values = [...results.values()];
    const up = values.filter((item) => item.ok).length;
    const slow = values.filter((item) => item.ok && item.latencyMs > item.slowThresholdMs).length;
    const down = values.filter((item) => !item.ok).length;
    return `${up} up, ${slow} slow, ${down} down`;
  }, [results]);

  const stats = useMemo(() => {
    const values = [...results.values()];
    return {
      total: monitoredServices.length,
      up: values.filter((item) => item.ok && item.latencyMs <= item.slowThresholdMs).length,
      slow: values.filter((item) => item.ok && item.latencyMs > item.slowThresholdMs).length,
      down: values.filter((item) => !item.ok).length
    };
  }, [results]);

  function clearLogs(service: MonitoredService) {
    localStorage.removeItem(logKey(service));
    setLogsVersion((version) => version + 1);
  }

  function toggleGlobalPaused() {
    const nextPaused = !globalPaused;
    localStorage.setItem(GLOBAL_PAUSED_KEY, String(nextPaused));
    setGlobalPaused(nextPaused);
    setPausedVersion((version) => version + 1);
  }

  function toggleServicePaused(service: MonitoredService) {
    const nextPaused = !isServicePaused(service);
    localStorage.setItem(pausedKey(service), String(nextPaused));
    setPausedVersion((version) => version + 1);
  }

  return (
    <main className="shell">
      <header className="hero">
        <div>
          <p className="eyebrow">Live monitor</p>
          <h1>Service Status</h1>
          <p className="hero-copy">Track uptime, latency, recent ping logs, and each service&apos;s next scheduled browser check.</p>
        </div>
        <div className="summary" aria-live="polite">
          <span id="summaryText">{summary}</span>
          <span>{lastChecked}</span>
          <button className={`pause-all ${globalPaused ? "paused" : ""}`} type="button" onClick={toggleGlobalPaused}>
            {globalPaused ? "Resume all" : "Pause all"}
          </button>
        </div>
      </header>

      <section className="stats" aria-label="Status summary">
        <div className="stat">
          <span className="stat-label">Services</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Healthy</span>
          <strong>{stats.up}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Slow</span>
          <strong>{stats.slow}</strong>
        </div>
        <div className="stat">
          <span className="stat-label">Down</span>
          <strong>{stats.down}</strong>
        </div>
      </section>

      <section className="groups" aria-live="polite">
        {[...groupedServices.entries()].map(([project, services]) => (
          <section className="project" key={project}>
            <div className="project-header">
              <h2>{project}</h2>
              <span className="project-count">{services.length} {services.length === 1 ? "service" : "services"}</span>
            </div>
            <div className="services">
              {services.map((service) => {
                const key = serviceKey(service);
                const result = results.get(key);
                const status = getStatus(result, service);
                const code = result?.status ? `HTTP ${result.status}` : result?.note || "Waiting";
                const latency = result ? formatLatency(result.latencyMs) : "Checking";
                const logs = typeof window === "undefined" ? [] : loadLogs(service);
                const lastPingAt = lastPingTimes.get(key);
                const intervalMs = Math.max(1, service.intervalMinutes) * 60 * 1000;
                const nextPingAt = lastPingAt ? lastPingAt + intervalMs : now;
                const servicePaused = isServicePaused(service);
                const nextPingText = globalPaused || servicePaused ? "Paused" : lastPingAt ? formatDuration(nextPingAt - now) : "now";
                const lastPingText = lastPingAt
                  ? new Date(lastPingAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit"
                  })
                  : "Not yet";

                return (
                  <article className="service" key={key}>
                    <div className={`service-accent ${servicePaused ? "paused" : status.className}`}></div>
                    <div className="service-summary">
                      <div className="service-main">
                        <h3 className="service-name">{service.name}</h3>
                        <a className="service-url" href={service.url} target="_blank" rel="noreferrer">{service.url}</a>
                        <div className="meta">
                          <span>{code}</span>
                          <span>{latency}</span>
                          <span>Every {service.intervalMinutes}m</span>
                          {servicePaused ? <span>Paused</span> : null}
                        </div>
                      </div>
                      <span className={`status ${servicePaused ? "paused" : status.className}`}>{servicePaused ? "Paused" : status.label}</span>
                    </div>

                    <div className="service-metrics" aria-label={`${service.name} ping timing`}>
                      <div>
                        <span>Next ping</span>
                        <strong>{nextPingText}</strong>
                      </div>
                      <div>
                        <span>Last ping</span>
                        <strong>{lastPingText}</strong>
                      </div>
                      <div>
                        <span>Slow after</span>
                        <strong>{formatLatency(service.slowThresholdMs)}</strong>
                      </div>
                    </div>

                    <div className="service-logs">
                      <div className="log-header">
                        <span>Ping logs <small>latest {LOG_LIMIT}</small></span>
                        <div className="log-actions">
                          <button className="clear-logs" type="button" onClick={() => toggleServicePaused(service)}>
                            {servicePaused ? "Resume" : "Pause"}
                          </button>
                          <button className="clear-logs" type="button" onClick={() => clearLogs(service)}>Clear logs</button>
                        </div>
                      </div>
                      <ul className="log-list" data-version={`${logsVersion}-${pausedVersion}`}>
                        {logs.length ? logs.map((entry) => (
                          <li className="log-row" key={`${entry.timestamp}-${entry.code}-${entry.latency}`}>
                            <span className={`log-dot ${entry.className}`}></span>
                            <span className="log-time">{new Date(entry.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit"
                            })}</span>
                            <span className="log-status">{entry.label}</span>
                            <span>{entry.code}</span>
                            <span>{entry.latency}</span>
                            {entry.detail ? <span>{entry.detail}</span> : null}
                          </li>
                        )) : <li className="log-empty">No logs yet.</li>}
                      </ul>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </section>
    </main>
  );
}
