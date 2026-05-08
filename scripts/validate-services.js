const path = require("path");

const filePath = path.join(process.cwd(), "public", "services.js");
const services = require(filePath);

if (!Array.isArray(services)) {
  throw new Error("public/services.js must export an array.");
}

for (const [index, service] of services.entries()) {
  for (const field of ["project", "name", "url"]) {
    if (!service[field] || typeof service[field] !== "string") {
      throw new Error(`Service at index ${index} is missing a string "${field}".`);
    }
  }

  const parsed = new URL(service.url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Service at index ${index} must use an HTTP or HTTPS URL.`);
  }

  if (
    service.slowThresholdMs !== undefined &&
    (!Number.isFinite(service.slowThresholdMs) || service.slowThresholdMs <= 0)
  ) {
    throw new Error(`Service at index ${index} has an invalid slowThresholdMs value.`);
  }

  if (
    service.intervalMinutes !== undefined &&
    (!Number.isInteger(service.intervalMinutes) || service.intervalMinutes <= 0)
  ) {
    throw new Error(`Service at index ${index} has an invalid intervalMinutes value.`);
  }
}

console.log(`Validated ${services.length} service${services.length === 1 ? "" : "s"}.`);
