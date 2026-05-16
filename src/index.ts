import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig } from "./config.js";
import { ZipStationApi } from "./api.js";
import { registerWhoami } from "./tools/whoami.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerStoryTools } from "./tools/stories.js";
import { registerTicketTools } from "./tools/tickets.js";

const config = loadConfig();

function extractPat(req: Request): string | null {
  const auth = req.header("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token.startsWith("zs_pat_") ? token : null;
}

function buildServer(pat: string): McpServer {
  const server = new McpServer({
    name: "zip-station-mcp",
    version: "0.1.0",
  });
  const api = new ZipStationApi(config.zipStationApiUrl, pat);
  registerWhoami(server, api);
  registerProjectTools(server, api);
  registerStoryTools(server, api);
  registerTicketTools(server, api);
  return server;
}

const app = express();
app.use(express.json({ limit: "4mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", apiUrl: config.zipStationApiUrl });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const pat = extractPat(req);
  if (!pat) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Missing or invalid bearer token. Expected 'Authorization: Bearer zs_pat_...'." },
      id: null,
    });
    return;
  }

  try {
    const server = buildServer(pat);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "GET not supported in stateless mode." },
    id: null,
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "DELETE not supported in stateless mode." },
    id: null,
  });
});

app.listen(config.port, () => {
  console.log(`zip-station-mcp listening on :${config.port}`);
  console.log(`forwarding to ${config.zipStationApiUrl}`);
});
