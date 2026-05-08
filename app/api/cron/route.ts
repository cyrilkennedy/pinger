import { NextResponse } from "next/server";
import { getMinuteStamp, isServiceDue, pingService } from "@/lib/ping";
import { monitoredServices } from "@/lib/services";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const respectIntervals = process.env.RESPECT_SERVICE_INTERVALS === "true" || searchParams.get("respectIntervals") === "true";
  const minuteStamp = getMinuteStamp();
  const dueServices = respectIntervals
    ? monitoredServices.filter((service) => isServiceDue(service, minuteStamp))
    : monitoredServices;
  const results = await Promise.all(dueServices.map(pingService));

  for (const result of results) {
    const status = result.status ?? "ERR";
    const message = result.error ? ` error=${result.error}` : "";
    console.log(
      `[${result.timestamp}] ${result.project} / ${result.name} ${result.url} interval=${result.intervalMinutes}m status=${status} latency=${result.latencyMs}ms ok=${result.ok}${message}`
    );
  }

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      respectIntervals,
      configuredCount: monitoredServices.length,
      count: results.length,
      skippedCount: monitoredServices.length - dueServices.length,
      results
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
