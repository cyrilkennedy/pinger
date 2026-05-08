# Pinger

A tiny Next.js + TypeScript health monitor and public status page for Vercel.

## Configure services

Edit `lib/services.ts` and add one object to the `monitoredServices` array per service:

```ts
{
  project: "My App",
  name: "API",
  url: "https://my-api.onrender.com/health",
  intervalMinutes: 14,
  slowThresholdMs: 1000
}
```

The same file powers both the Vercel cron endpoint and the status page.

## Cron pinger

Vercel runs `/api/cron` using the schedule in `vercel.json`. Each service decides its own cadence with `intervalMinutes`, and the function only pings the services that are due on that run.

For example, `intervalMinutes: 5` pings about every 5 minutes, while `intervalMinutes: 14` pings about every 14 minutes. The function writes timestamp, project, service name, URL, configured interval, status code, response time, and any error to Vercel logs.

Important: Vercel Hobby accounts currently only allow cron jobs once per day. The included `vercel.json` uses a deploy-safe daily cron and pings all services on that run. If your project is on Vercel Pro, change the schedule to `* * * * *` and set `RESPECT_SERVICE_INTERVALS=true` so per-service minute intervals work as intended.

You can also visit `/api/cron` manually to trigger a check and see the JSON results.

## Status page

The status page loads the services from `lib/services.ts`, checks each service through `/api/ping`, refreshes every 60 seconds, and stores the latest 20 visible ping logs per service in browser `localStorage`.

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Deploy

Deploy the folder to Vercel using the Next.js framework preset. No database, queue, or persistent server is required.

If Vercel says `No Output Directory named "public" found`, clear the old static-site setting:

- Project Settings -> Build and Development Settings
- Framework Preset: `Next.js`
- Output Directory: remove `public` / leave empty
- Redeploy

The repo also sets `"framework": "nextjs"` and `"outputDirectory": null` in `vercel.json` so new deployments should use the Next.js defaults.
