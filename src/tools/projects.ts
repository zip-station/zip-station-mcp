import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZipStationApi } from "../api.js";

interface ProjectSummary {
  id: string;
  name: string;
  slug?: string;
  description?: string;
}

export function registerProjectTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List all projects in a Zip Station company that the authenticated user can access.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
      },
    },
    async ({ companyId }) => {
      const projects = await api.get<ProjectSummary[]>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects`
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug ?? null })),
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
