import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZipStationApi } from "../api.js";

interface KanbanStorySummary {
  id: string;
  cardNumber: number;
  title: string;
  projectId: string;
  columnId?: string;
  columnName?: string;
  isResolved?: boolean;
}

interface KanbanStoryDetail extends KanbanStorySummary {
  bodyHtml?: string;
  assignedToUserId?: string;
  comments?: Array<{ id: string; bodyHtml: string; authorName?: string; createdOnDateTime: number }>;
  linkedTicketIds?: string[];
}

const STORY_TYPES = ["Feature", "Bug", "Improvement", "TechDebt"] as const;
const STORY_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;

export function registerStoryTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "create_story",
    {
      title: "Create story",
      description:
        "Create a new kanban story (card) in a project's board. Returns the created story including its card number. " +
        "If `columnId` is omitted, the story lands in the board's first column (typically the backlog / To Do).",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project whose board the story is added to."),
        title: z.string().min(1).describe("Story title (required)."),
        descriptionHtml: z.string().optional().describe("Story description (HTML)."),
        type: z.enum(STORY_TYPES).optional().describe("Story type. Default Feature."),
        priority: z.enum(STORY_PRIORITIES).optional().describe("Priority. Default Normal."),
        columnId: z.string().optional().describe("Target column (state) ID. Omit to use the board's first column."),
        tags: z.array(z.string()).optional().describe("Tags to apply to the story."),
        assignedToUserId: z.string().optional().describe("User ID to assign the story to."),
        linkedTicketIds: z.array(z.string()).optional().describe("Ticket IDs to link to this story."),
      },
    },
    async ({ companyId, projectId, title, descriptionHtml, type, priority, columnId, tags, assignedToUserId, linkedTicketIds }) => {
      const story = await api.post<KanbanStoryDetail>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards`,
        {
          columnId: columnId ?? "",
          title,
          descriptionHtml,
          type: type ?? "Feature",
          priority: priority ?? "Normal",
          tags,
          assignedToUserId,
          linkedTicketIds,
        }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(story, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      description:
        "Search kanban stories in a company across every state. Returns up to 25 most-recently-updated stories matching the filters. " +
        "A story's state is its kanban column (see `columnName` in the results, e.g. 'To Do', 'In Progress', 'Done'). " +
        "Pass `status` to filter to a single state by column name. Stories in the resolved column are excluded unless includeResolved is true.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().optional().describe("Limit to a single project. Omit to search across all accessible projects."),
        query: z.string().optional().describe("Free-text query. Supports 'STR-23' card numbers and title substring match."),
        status: z
          .string()
          .optional()
          .describe("Filter by state — the kanban column name (case-insensitive), e.g. 'In Progress'. Omit to include every state."),
        includeResolved: z.boolean().optional().describe("If true, include stories in the resolved column. Default false."),
      },
    },
    async ({ companyId, projectId, query, status, includeResolved }) => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (query) params.set("query", query);
      if (status) params.set("status", status);
      const qs = params.toString();
      const stories = await api.get<KanbanStorySummary[]>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/stories${qs ? `?${qs}` : ""}`
      );
      const filtered = includeResolved ? stories : stories.filter((s) => !s.isResolved);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(filtered, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "get_story",
    {
      title: "Get story",
      description: "Fetch full detail of a kanban story by its card number (e.g. 23 for STR-23) within a project.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Story card number (e.g. 23 for STR-23)."),
      },
    },
    async ({ companyId, projectId, cardNumber }) => {
      const story = await api.get<KanbanStoryDetail>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${cardNumber}`
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(story, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "add_story_comment",
    {
      title: "Add story comment",
      description: "Append a comment to a kanban story. Body is HTML; plain text works (it will be displayed as-is).",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        storyId: z.string().describe("Internal story ID (the 'id' field from list_stories / get_story, NOT the card number)."),
        bodyHtml: z.string().min(1).describe("Comment body (HTML allowed)."),
      },
    },
    async ({ companyId, projectId, storyId, bodyHtml }) => {
      const comment = await api.post<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(storyId)}/comments`,
        { bodyHtml }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(comment, null, 2) },
        ],
      };
    }
  );
}
