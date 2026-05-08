// Add every service you want to monitor here.
// One object equals one URL on both the Vercel cron pinger and the status page.
const MONITORED_SERVICES = [
  {
    project: "Example Project",
    name: "Example API",
    url: "https://example.com",
    intervalMinutes: 14,
    slowThresholdMs: 1000
  },
  {
    project: "My App",
    name: "wemsty backend",
    url: "https://api.wemsty.com/api/health",
    intervalMinutes: 10,
    slowThresholdMs: 1500
  }
];

if (typeof window !== "undefined") {
  window.MONITORED_SERVICES = MONITORED_SERVICES;
}

if (typeof module !== "undefined") {
  module.exports = MONITORED_SERVICES;
}
