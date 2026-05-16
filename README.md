# zip-station-mcp

A hosted [MCP](https://modelcontextprotocol.io/) server that bridges Claude Code (and any other MCP-capable client) to a [Zip Station](https://github.com/zip-station) instance. Users authenticate with a Personal Access Token minted in the Zip Station dashboard; the server forwards their calls to the Zip Station API.

It ships as a container alongside the rest of the Zip Station stack — no separate install on the end user's machine.

## How it fits in

```
Claude Code  ──Authorization: Bearer zs_pat_…──►  zip-station-mcp  ──►  zip-station-service (.NET API)  ──►  MongoDB
```

Per-request, stateless. The MCP server holds no session state; the bearer token on each request is forwarded verbatim to the API, which validates it via the custom PAT authentication handler.

## Available tools (v1)

| Tool | What it does |
|---|---|
| `whoami` | Returns the Zip Station user the PAT belongs to. |
| `list_projects` | Lists projects the caller can access in a company. |
| `list_stories` | Searches kanban stories. Resolved stories filtered out by default. |
| `get_story` | Full detail of one kanban story by card number (e.g. 23 for STR-23). |
| `add_story_comment` | Posts a comment on a kanban story (uses internal story ID, not card number). |
| `get_ticket` | Reads a ticket and its messages. |
| `add_ticket_message` | Adds a reply or internal note. Email-sends if not an internal note and the project has SMTP configured. |

## Running it

### As part of the Zip Station stack (recommended)

The `zip-station/` orchestration repo wires this service in. Bring up the full stack:

```bash
# in zip-station/
docker compose -f docker-compose.dev.yml up --build mcp   # build from local source
# or, in production (pulls from GHCR):
docker compose up -d mcp
```

The container listens on `:5101` and forwards to the API container at `http://api:80`.

### Standalone (for development of this repo only)

```bash
npm install
ZIP_STATION_API_URL=http://localhost:5100 npm run dev
```

Watches `src/` and restarts on change. The API URL points at whatever Zip Station API you're hitting — typically a `dotnet run` of `ZipStation.Api` on `:5100`.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `5101` | HTTP port the MCP server listens on. |
| `ZIP_STATION_API_URL` | `http://api:80` | Base URL of the Zip Station API. Inside the compose network this is `http://api:80`; standalone it's whatever you run locally. |

## Connecting an MCP client

1. In the Zip Station dashboard: **Settings → Personal Access Tokens → New token**. Copy the `zs_pat_...` token (only shown once).
2. The token-create dialog also shows a ready-to-paste `claude mcp add ...` command — use that, or run manually:
   ```bash
   claude mcp add --transport http --scope user zip-station \
     https://your-zip-station.example.com/mcp \
     --header "Authorization: Bearer zs_pat_yourtoken"
   ```
3. Verify in Claude Code: `/mcp` should list `zip-station` with its tools. Try "what's my Zip Station identity?" — Claude calls `whoami`.

See the [user-facing docs](https://github.com/zip-station/zip-station-docs/blob/main/docs/user-guide/personal-access-tokens.md) for the full walkthrough including troubleshooting.

## Adding a tool

Tools live under `src/tools/`. Each module exports a `register*Tools(server, api)` function that calls `server.registerTool(name, schema, handler)`. The `ZipStationApi` instance is already authenticated as the calling user — just call `api.get(...)`, `api.post(...)`, etc.

Example skeleton:

```ts
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZipStationApi } from "../api.js";

export function registerMyTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "my_tool",
    {
      title: "Short title",
      description: "What the tool does. Be specific — the LLM picks tools off this.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        // …
      },
    },
    async ({ companyId }) => {
      const result = await api.get(`/api/v1/companies/${encodeURIComponent(companyId)}/something`);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    }
  );
}
```

Register the new file in `src/index.ts` alongside the existing `register*` calls. Rebuild the container; clients pick up the new tool on next connection.

## Architecture notes

- **Stateless Streamable HTTP transport.** Each `POST /mcp` request builds a fresh `McpServer` scoped to that request's PAT. No session IDs, no shared state between calls.
- **No token caching.** Every tool call hits the API; the API re-validates the PAT (user not disabled, token not revoked/expired) on every request. Revocation is immediate.
- **Owner bypass and role checks happen on the API side.** The MCP server has no concept of permissions — it just forwards. A PAT can do anything its owning user can do.

## License

Same as the rest of Zip Station — see `LICENSE` (or the umbrella repo).
