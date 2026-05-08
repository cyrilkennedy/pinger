export type MonitoredService = {
  project: string;
  name: string;
  url: string;
  intervalMinutes: number;
  slowThresholdMs: number;
};

export const monitoredServices: MonitoredService[] = [
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
