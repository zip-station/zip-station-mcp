export interface McpConfig {
  port: number;
  zipStationApiUrl: string;
}

export function loadConfig(): McpConfig {
  const port = Number(process.env.PORT ?? 5101);
  const zipStationApiUrl = process.env.ZIP_STATION_API_URL ?? "http://api:80";
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`Invalid PORT: ${process.env.PORT}`);
  }
  if (!zipStationApiUrl) {
    throw new Error("ZIP_STATION_API_URL is required");
  }
  return { port, zipStationApiUrl: zipStationApiUrl.replace(/\/$/, "") };
}
