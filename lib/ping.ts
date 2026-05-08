import type { MonitoredService } from "./services";

const REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_INTERVAL_MINUTES = 14;

export type PingResult = {
  project: string;
  name: string;
  url: string;
  intervalMinutes: number;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  timestamp: string;
  error?: string;
};

export function getIntervalMinutes(service: MonitoredService) {
  return service.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
}

export function getMinuteStamp(date = new Date()) {
  return Math.floor(date.getTime() / 60000);
}

export function getServiceOffset(service: MonitoredService, intervalMinutes: number) {
  const key = `${service.project}:${service.name}:${service.url}`;
  let hash = 0;

  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }

  return hash % intervalMinutes;
}

export function isServiceDue(service: MonitoredService, minuteStamp: number) {
  const intervalMinutes = getIntervalMinutes(service);
  const offset = getServiceOffset(service, intervalMinutes);

  return minuteStamp % intervalMinutes === offset;
}

export async function pingUrl(url: string) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "vercel-pinger/1.0"
      }
    });

    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error && error.name === "AbortError" ? "Request timed out" : error instanceof Error ? error.message : "Request failed",
      timestamp: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function pingService(service: MonitoredService): Promise<PingResult> {
  const result = await pingUrl(service.url);

  return {
    project: service.project,
    name: service.name,
    url: service.url,
    intervalMinutes: getIntervalMinutes(service),
    ...result
  };
}
