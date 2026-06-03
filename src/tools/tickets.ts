import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZipStationApi } from "../api.js";

const TICKET_STATUSES = ["Open", "Pending", "Resolved", "Closed", "Merged", "Abandoned"] as const;
const TICKET_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;

export function registerTicketTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "list_tickets",
    {
      title: "List tickets",
      description:
        "List and search tickets in a company across every status. Returns a paginated set ordered by newest first. " +
        "Omit `status` to see tickets in all states; pass one or more states to filter (e.g. ['Open','Pending']). " +
        "Use `query` for free-text search over subject, customer name/email, and ticket number.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().optional().describe("Limit to a single project. Omit to search across all accessible projects."),
        status: z
          .array(z.enum(TICKET_STATUSES))
          .optional()
          .describe("Filter to one or more states. Omit to include every state (Open, Pending, Resolved, Closed, Merged, Abandoned)."),
        priority: z.enum(TICKET_PRIORITIES).optional().describe("Filter by priority."),
        query: z.string().optional().describe("Free-text search over subject, customer name/email, and ticket number."),
        assignedTo: z
          .string()
          .optional()
          .describe("Filter by assignee. Use 'me' for your own tickets, 'unassigned' for unassigned, or a user ID."),
        page: z.number().int().positive().optional().describe("Page number (1-based). Default 1."),
        resultsPerPage: z.number().int().positive().max(100).optional().describe("Results per page. Default 25."),
      },
    },
    async ({ companyId, projectId, status, priority, query, assignedTo, page, resultsPerPage }) => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (status) for (const s of status) params.append("status", s);
      if (priority) params.set("priority", priority);
      if (query) params.set("query", query);
      if (assignedTo) params.set("assignedTo", assignedTo);
      if (page) params.set("page", String(page));
      if (resultsPerPage) params.set("resultsPerPage", String(resultsPerPage));
      const qs = params.toString();
      const result = await api.get<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/tickets${qs ? `?${qs}` : ""}`
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

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
