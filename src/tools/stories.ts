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

// The GET board/cards/{cardNumber} endpoint returns a detail envelope, not a flat card.
interface KanbanCardDetailEnvelope {
  card: { id: string; cardNumber: number; title: string };
}

const STORY_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;

/**
 * Resolve a story to its internal card id. Mutation endpoints (PATCH/DELETE cards/{id})
 * key on the internal id, but humans think in STR-NN card numbers — accept either.
 * A card number costs one extra GET to look up; an internal id is used as-is.
 */
async function resolveStoryId(
  api: ZipStationApi,
  companyId: string,
  projectId: string,
  ref: { storyId?: string; cardNumber?: number }
): Promise<string> {
  if (ref.storyId) return ref.storyId;
  if (ref.cardNumber == null) throw new Error("Provide either storyId or cardNumber.");
  const detail = await api.get<KanbanCardDetailEnvelope>(
    `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${ref.cardNumber}`
  );
  const id = detail?.card?.id;
  if (!id) throw new Error(`Story STR-${ref.cardNumber} not found in this project.`);
  return id;
}

export function registerStoryTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "list_stories",
    {
      title: "List stories",
      description:
        "Search kanban stories in a company. Returns up to 25 most-recently-updated stories matching the query. Stories that are in the resolved column are excluded unless includeResolved is true.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().optional().describe("Limit to a single project. Omit to search across all accessible projects."),
        query: z.string().optional().describe("Free-text query. Supports 'STR-23' card numbers and title substring match."),
        includeResolved: z.boolean().optional().describe("If true, include stories in the resolved column. Default false."),
      },
    },
    async ({ companyId, projectId, query, includeResolved }) => {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      if (query) params.set("query", query);
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

  server.registerTool(
    "delete_story",
    {
      title: "Delete story",
      description:
        "Delete a kanban story (a.k.a. archive it off the board). This is a soft delete on the server — the card is voided and disappears from the board, identical to deleting from the UI; it is not purged. Zip Station has no separate manual 'archive' action, so use this to remove or archive a story. Identify the story by its card number (e.g. 23 for STR-23) or its internal storyId.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().optional().describe("Story card number (e.g. 23 for STR-23). Provide this or storyId."),
        storyId: z.string().optional().describe("Internal story ID (the 'id' field from list_stories / get_story). Provide this or cardNumber."),
      },
    },
    async ({ companyId, projectId, cardNumber, storyId }) => {
      const id = await resolveStoryId(api, companyId, projectId, { storyId, cardNumber });
      await api.delete<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(id)}`
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ deleted: true, storyId: id, cardNumber }, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "set_story_priority",
    {
      title: "Set story priority (bulk)",
      description:
        "Set the priority of one or more kanban stories in a project. Provide the target priority plus the stories to change, identified by card number (cardNumbers) and/or internal id (storyIds). Each story is updated independently — the result reports per-story success/failure, so a single bad reference does not abort the batch.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the stories belong to. All target stories must be in this project."),
        priority: z.enum(STORY_PRIORITIES).describe("Target priority to apply to every listed story."),
        cardNumbers: z.array(z.number().int().positive()).optional().describe("Card numbers to update (e.g. [23, 24] for STR-23, STR-24)."),
        storyIds: z.array(z.string()).optional().describe("Internal story IDs to update (the 'id' field from list_stories)."),
      },
    },
    async ({ companyId, projectId, priority, cardNumbers, storyIds }) => {
      const refs: Array<{ cardNumber?: number; storyId?: string }> = [
        ...(cardNumbers ?? []).map((n) => ({ cardNumber: n })),
        ...(storyIds ?? []).map((id) => ({ storyId: id })),
      ];
      if (refs.length === 0)
        throw new Error("Provide at least one story via cardNumbers or storyIds.");

      const results: Array<{ cardNumber?: number; storyId?: string; ok: boolean; error?: string }> = [];
      for (const ref of refs) {
        try {
          const id = await resolveStoryId(api, companyId, projectId, ref);
          await api.patch<unknown>(
            `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(id)}`,
            { priority }
          );
          results.push({ ...ref, storyId: id, ok: true });
        } catch (err) {
          results.push({ ...ref, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const updated = results.filter((r) => r.ok).length;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ priority, updated, total: refs.length, results }, null, 2),
          },
        ],
      };
    }
  );
}
