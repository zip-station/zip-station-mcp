import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZipStationApi } from "../api.js";

export function registerWhoami(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "whoami",
    {
      title: "Who am I?",
      description: "Returns the Zip Station user that this MCP connection is authenticated as.",
      inputSchema: {},
    },
    async () => {
      const user = await api.whoami();
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                id: user.id,
                email: user.email,
                displayName: user.displayName ?? null,
                isOwner: user.isOwner ?? false,
                companies: Array.from(
                  new Set((user.roleAssignments ?? []).map((ra) => ra.companyId))
                ),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
  // Silence unused-import warnings — z is reserved for future tool input schemas.
  void z;
}
