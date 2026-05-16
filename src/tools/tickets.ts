import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZipStationApi } from "../api.js";

export function registerTicketTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "get_ticket",
    {
      title: "Get ticket",
      description: "Fetch a ticket by internal ID, including its messages and metadata.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        ticketId: z.string().describe("Internal ticket ID (24-char ObjectId)."),
      },
    },
    async ({ companyId, ticketId }) => {
      const ticket = await api.get<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/tickets/${encodeURIComponent(ticketId)}`
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(ticket, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "add_ticket_message",
    {
      title: "Add ticket message",
      description:
        "Add a message (reply to customer or internal note) to a ticket. If isInternalNote is false and the project has SMTP configured, the message will be emailed to the customer.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        ticketId: z.string().describe("Internal ticket ID (24-char ObjectId)."),
        bodyHtml: z.string().min(1).describe("Message body (HTML)."),
        body: z.string().optional().describe("Plaintext fallback. Defaults to a stripped version of bodyHtml on the server."),
        isInternalNote: z
          .boolean()
          .optional()
          .describe("If true, the message is an internal note and is NOT emailed to the customer. Default false."),
      },
    },
    async ({ companyId, ticketId, bodyHtml, body, isInternalNote }) => {
      const message = await api.post<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/tickets/${encodeURIComponent(ticketId)}/messages`,
        {
          body: body ?? bodyHtml.replace(/<[^>]+>/g, ""),
          bodyHtml,
          isInternalNote: isInternalNote ?? false,
          hasPendingAttachments: false,
        }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(message, null, 2) },
        ],
      };
    }
  );
}
