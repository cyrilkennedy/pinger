# Pinger

A tiny Vercel keep-alive and public status page.

## Configure services

Edit `public/services.js` and add one object to the `MONITORED_SERVICES` array per service:

```js
{
  project: "My App",
  name: "API",
  url: "https://my-api.onrender.com/health",
  intervalMinutes: 14,
  slowThresholdMs: 1000
}
```

The same file powers both the Vercel cron endpoint and the static status page.

## Cron pinger

Vercel runs `/api/cron` every minute using the schedule in `vercel.json`. Each service decides its own cadence with `intervalMinutes`, and the function only pings the services that are due on that run.

For example, `intervalMinutes: 5` pings about every 5 minutes, while `intervalMinutes: 14` pings about every 14 minutes. The function writes timestamp, project, service name, URL, configured interval, status code, response time, and any error to Vercel logs.

You can also visit `/api/cron` manually to trigger a check and see the JSON results.

## Status page

The static page loads `services.json`, checks each service directly from the browser, and refreshes every 60 seconds.

```bash
npm run dev
```

Then open `http://localhost:3000`.

## Deploy

Deploy the folder to Vercel. No database, queue, or persistent server is required.
