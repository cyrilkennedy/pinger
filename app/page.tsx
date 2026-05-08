"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { monitoredServices, type MonitoredService } from "@/lib/services";

const REFRESH_MS = 60000;
const DEFAULT_SLOW_THRESHOLD_MS = 1000;
const LOG_LIMIT = 20;
const LOG_PREFIX = "pinger:logs:";

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

function formatLatency(value: number) {
  if (!Number.isFinite(value)) return "No response";
  return value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${Math.round(value)}ms`;
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
  const currentRun = useRef(0);

  const groupedServices = useMemo(() => {
    return monitoredServices.reduce((groups, service) => {
      const project = service.project || "Services";
      groups.set(project, [...(groups.get(project) || []), service]);
      return groups;
    }, new Map<string, MonitoredService[]>());
  }, []);

  const refresh = useCallback(async () => {
    const runId = currentRun.current + 1;
    currentRun.current = runId;
    setResults(new Map());

    const settled = await Promise.all(monitoredServices.map((service) => ping(service, runId, () => currentRun.current)));
    if (runId !== currentRun.current) return;

    const nextResults = new Map<string, BrowserPingResult>();

    for (const result of settled) {
      if (result) nextResults.set(result.key, result);
    }

    for (const service of monitoredServices) {
      const result = nextResults.get(serviceKey(service));
      if (!result) continue;

      saveLogs(service, [buildLogEntry(service, result), ...loadLogs(service)].slice(0, LOG_LIMIT));
    }

    setResults(nextResults);
    setLogsVersion((version) => version + 1);
    setLastChecked(`Checked ${new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })}`);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const summary = useMemo(() => {
    const values = [...results.values()];
    const up = values.filter((item) => item.ok).length;
    const slow = values.filter((item) => item.ok && item.latencyMs > item.slowThresholdMs).length;
    const down = values.filter((item) => !item.ok).length;
    return `${up} up, ${slow} slow, ${down} down`;
  }, [results]);

  function clearLogs(service: MonitoredService) {
    localStorage.removeItem(logKey(service));
    setLogsVersion((version) => version + 1);
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Live monitor</p>
          <h1>Service Status</h1>
        </div>
        <div className="summary" aria-live="polite">
          <span id="summaryText">{summary}</span>
          <span>{lastChecked}</span>
        </div>
      </header>

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

                return (
                  <article className="service" key={key}>
                    <div className="service-summary">
                      <div className="service-main">
                        <h3 className="service-name">{service.name}</h3>
                        <a className="service-url" href={service.url} target="_blank" rel="noreferrer">{service.url}</a>
                        <div className="meta">
                          <span>{code}</span>
                          <span>{latency}</span>
                        </div>
                      </div>
                      <span className={`status ${status.className}`}>{status.label}</span>
                    </div>

                    <div className="service-logs">
                      <div className="log-header">
                        <span>Ping logs</span>
                        <button className="clear-logs" type="button" onClick={() => clearLogs(service)}>Clear logs</button>
                      </div>
                      <ul className="log-list" data-version={logsVersion}>
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
