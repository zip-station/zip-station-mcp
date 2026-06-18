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

// The kanban card itself (returned directly by create / PATCH).
interface KanbanCard {
  id: string;
  cardNumber: number;
  columnId: string;
  position: number;
  title: string;
  projectId: string;
  assignedToUserId?: string;
  linkedTicketIds?: string[];
  linkedStoryIds?: string[];
}

// GET /board/cards/{cardNumber} returns this wrapper — the card is nested under `card`,
// alongside its comments and linked entities. NOT a bare card.
interface KanbanCardDetail {
  card: KanbanCard;
  comments?: Array<{ id: string; bodyHtml: string; authorName?: string; createdOnDateTime: number }>;
  linkedTickets?: unknown[];
  linkedStories?: unknown[];
}

interface KanbanColumn {
  id: string;
  name: string;
  color?: string;
  position: number;
}

interface KanbanCardTypeDefinition {
  id: string;
  label: string;
  color?: string;
}

interface KanbanBoard {
  id: string;
  companyId: string;
  projectId: string;
  columns: KanbanColumn[];
  resolvedColumnId: string;
  intakeColumnId?: string;
  customCardTypes?: KanbanCardTypeDefinition[];
}

// The four always-available built-ins. A project may also define custom types on its board
// (KanbanBoard.customCardTypes); a story's `type` can be a built-in name OR a custom type id.
// `type` is accepted as a free string (the API validates it against this project's board) so
// custom types work over MCP — call get_board to discover their ids.
const BUILTIN_STORY_TYPES = "Feature, Bug, Improvement, TechDebt";
const STORY_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;

// Gap used when placing a story at the top/bottom of a column or past an end card.
// Matches the API's PositionStep (KanbanBoardController) so MCP-driven and UI-driven
// ordering share the same fractional-position scale. Lower position = higher in column.
const POSITION_STEP = 1000;

export function registerStoryTools(server: McpServer, api: ZipStationApi) {
  server.registerTool(
    "create_story",
    {
      title: "Create story",
      description:
        "Create a new kanban story (card) in a project's board. Returns the created story including its card number. " +
        "If `columnId` is omitted, the story lands in the board's configured intake column (see get_board's intakeColumnId).",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project whose board the story is added to."),
        title: z.string().min(1).describe("Story title (required)."),
        descriptionHtml: z.string().optional().describe("Story description (HTML)."),
        type: z
          .string()
          .optional()
          .describe(`Story type. A built-in (${BUILTIN_STORY_TYPES}) or a project custom type id from get_board. Default Feature.`),
        priority: z.enum(STORY_PRIORITIES).optional().describe("Priority. Default Normal."),
        columnId: z.string().optional().describe("Target column (state) ID. Omit to use the board's intake column."),
        tags: z.array(z.string()).optional().describe("Tags to apply to the story."),
        assignedToUserId: z.string().optional().describe("User ID to assign the story to."),
        linkedTicketIds: z.array(z.string()).optional().describe("Ticket IDs to link to this story."),
      },
    },
    async ({ companyId, projectId, title, descriptionHtml, type, priority, columnId, tags, assignedToUserId, linkedTicketIds }) => {
      const story = await api.post<KanbanCard>(
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
      const story = await api.get<KanbanCardDetail>(
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
      description:
        "Append a comment to a kanban story. Body is HTML; plain text works (it will be displayed as-is). " +
        "Requires the story's internal ID, NOT its card number (e.g. STR-23). Get the ID from list_stories " +
        "(the top-level `id` field of each result) or from get_story (the `card.id` field). If you only have a card " +
        "number, call get_story first and read `card.id`.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        storyId: z
          .string()
          .describe(
            "Internal story ID — list_stories `id` or get_story `card.id`. NOT the card number (the number in STR-23)."
          ),
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
    "get_board",
    {
      title: "Get board (columns / states)",
      description:
        "Fetch a project's kanban board, including the ordered list of columns (states) with their IDs and names, " +
        "plus which column is the 'resolved' column, and any custom story types defined for this project. " +
        "Use this to discover the columnId for a state before calling move_story, or a custom story-type id before create_story/update_story.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project whose board to fetch."),
      },
    },
    async ({ companyId, projectId }) => {
      const board = await api.get<KanbanBoard>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board`
      );
      const columns = (board.columns ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((c) => ({
          id: c.id,
          name: c.name,
          position: c.position,
          isResolvedColumn: c.id === board.resolvedColumnId,
          isIntakeColumn: c.id === board.intakeColumnId,
        }));
      const customCardTypes = (board.customCardTypes ?? []).map((t) => ({
        id: t.id,
        label: t.label,
        color: t.color,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { boardId: board.id, resolvedColumnId: board.resolvedColumnId, intakeColumnId: board.intakeColumnId, columns, customCardTypes },
              null,
              2,
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "move_story",
    {
      title: "Move story to another column / state",
      description:
        "Move a kanban story (card) to a different column (state) — e.g. from 'To Do' to 'In Progress' or 'Done'. " +
        "Identify the story by its card number (e.g. 23 for STR-23). Specify the destination either by column name " +
        "(`toColumn`, case-insensitive) or by its ID (`toColumnId`). Moving a story into the board's resolved column " +
        "marks it resolved (and notifies linked tickets). Returns the updated story.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Story card number (e.g. 23 for STR-23)."),
        toColumn: z
          .string()
          .optional()
          .describe("Destination column/state name (case-insensitive), e.g. 'In Progress'. Provide this OR toColumnId."),
        toColumnId: z.string().optional().describe("Destination column ID. Provide this OR toColumn."),
      },
    },
    async ({ companyId, projectId, cardNumber, toColumn, toColumnId }) => {
      if (!toColumn && !toColumnId) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Provide either toColumn (name) or toColumnId." }],
        };
      }

      const board = await api.get<KanbanBoard>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board`
      );
      const columns = board.columns ?? [];

      let targetId = toColumnId;
      if (!targetId && toColumn) {
        const match = columns.find((c) => c.name.trim().toLowerCase() === toColumn.trim().toLowerCase());
        if (!match) {
          const names = columns.map((c) => c.name).join(", ");
          return {
            isError: true,
            content: [{ type: "text" as const, text: `No column named "${toColumn}" on this board. Available columns: ${names}.` }],
          };
        }
        targetId = match.id;
      } else if (targetId && !columns.some((c) => c.id === targetId)) {
        const names = columns.map((c) => `${c.name} (${c.id})`).join(", ");
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Column ID "${targetId}" is not on this board. Available columns: ${names}.` }],
        };
      }

      const story = await resolveStory(companyId, projectId, cardNumber);

      const updated = await api.patch<KanbanCard>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}`,
        { columnId: targetId }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "reorder_story",
    {
      title: "Reorder a story within its column",
      description:
        "Change a story's vertical order within its current column (state) — e.g. move STR-5 to sit right after STR-2. " +
        "This does NOT change the column; use move_story for that. Lower position = higher in the column (top). " +
        "Specify the destination ONE of these ways: `afterCardNumber` (place directly below that story), `beforeCardNumber` " +
        "(place directly above it), or `position` ('top' or 'bottom' of the column). When using after/before, the reference " +
        "story must be in the SAME column as the story being moved (move_story first if it isn't). Returns the updated story.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Card number of the story to move (e.g. 5 for STR-5)."),
        afterCardNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Place the story directly BELOW this story's card number (same column). Provide exactly one of afterCardNumber / beforeCardNumber / position."),
        beforeCardNumber: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Place the story directly ABOVE this story's card number (same column). Provide exactly one of afterCardNumber / beforeCardNumber / position."),
        position: z
          .enum(["top", "bottom"])
          .optional()
          .describe("Move to the very top or very bottom of the column. Provide exactly one of afterCardNumber / beforeCardNumber / position."),
      },
    },
    async ({ companyId, projectId, cardNumber, afterCardNumber, beforeCardNumber, position }) => {
      const specs = [
        afterCardNumber != null ? "afterCardNumber" : null,
        beforeCardNumber != null ? "beforeCardNumber" : null,
        position != null ? "position" : null,
      ].filter(Boolean);
      if (specs.length !== 1) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Provide exactly one of afterCardNumber, beforeCardNumber, or position.",
            },
          ],
        };
      }

      const refCardNumber = afterCardNumber ?? beforeCardNumber;
      if (refCardNumber === cardNumber) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: "Can't position a story relative to itself." }],
        };
      }

      const story = await resolveStory(companyId, projectId, cardNumber);

      // Pull the full column (sorted ascending by position = top→bottom on the server),
      // excluding the story being moved so we reason about its destination neighbors.
      const columnCards = (
        await api.get<KanbanCard[]>(
          `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards?columnId=${encodeURIComponent(story.columnId)}&includeArchived=true`
        )
      )
        .filter((c) => c.columnId === story.columnId && c.id !== story.id)
        .sort((a, b) => a.position - b.position);

      let newPosition: number;
      if (position === "top") {
        newPosition = (columnCards[0]?.position ?? 0) - POSITION_STEP;
      } else if (position === "bottom") {
        newPosition = (columnCards[columnCards.length - 1]?.position ?? 0) + POSITION_STEP;
      } else {
        const refIndex = columnCards.findIndex((c) => c.cardNumber === refCardNumber);
        if (refIndex === -1) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `STR-${refCardNumber} is not in the same column as STR-${cardNumber}. Move it there first (move_story), or reorder relative to a story in this column.`,
              },
            ],
          };
        }
        const ref = columnCards[refIndex];
        if (afterCardNumber != null) {
          const next = columnCards[refIndex + 1];
          newPosition = next ? (ref.position + next.position) / 2 : ref.position + POSITION_STEP;
        } else {
          const prev = columnCards[refIndex - 1];
          newPosition = prev ? (prev.position + ref.position) / 2 : ref.position - POSITION_STEP;
        }
      }

      const updated = await api.patch<KanbanCard>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}`,
        { position: newPosition }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "update_story",
    {
      title: "Update story fields",
      description:
        "Update a kanban story's fields (title, description, type, priority, tags, assignee). Identify the story by its " +
        "card number (e.g. 23 for STR-23). Only the fields you pass are changed. To move a story between columns/states, " +
        "use move_story instead. To assign, pass assignedToUserId; to unassign, pass clearAssignee: true.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Story card number (e.g. 23 for STR-23)."),
        title: z.string().min(1).optional().describe("New title."),
        descriptionHtml: z.string().optional().describe("New description (HTML)."),
        type: z
          .string()
          .optional()
          .describe(`New story type. A built-in (${BUILTIN_STORY_TYPES}) or a project custom type id from get_board.`),
        priority: z.enum(STORY_PRIORITIES).optional().describe("New priority."),
        tags: z.array(z.string()).optional().describe("Replace the story's tags with this list."),
        assignedToUserId: z.string().optional().describe("User ID to assign the story to."),
        clearAssignee: z.boolean().optional().describe("If true, remove the current assignee."),
      },
    },
    async ({ companyId, projectId, cardNumber, title, descriptionHtml, type, priority, tags, assignedToUserId, clearAssignee }) => {
      const story = await resolveStory(companyId, projectId, cardNumber);
      const updated = await api.patch<KanbanCard>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}`,
        { title, descriptionHtml, type, priority, tags, assignedToUserId, clearAssignee }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated, null, 2) },
        ],
      };
    }
  );

  // Resolve a story card number to its internal card (with the real `id`).
  // GET /board/cards/{cardNumber} wraps the card under `card`, so unwrap it here.
  async function resolveStory(companyId: string, projectId: string, cardNumber: number): Promise<KanbanCard> {
    const detail = await api.get<KanbanCardDetail>(
      `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${cardNumber}`
    );
    const card = detail?.card;
    if (!card?.id) {
      throw new Error(`Could not resolve story STR-${cardNumber} to an internal card ID (no card found for that number in this project).`);
    }
    return card;
  }

  server.registerTool(
    "delete_story",
    {
      title: "Delete story",
      description:
        "Delete a kanban story (card), identified by its card number (e.g. 23 for STR-23). This is a soft delete on " +
        "the server — the card is voided and removed from the board (identical to deleting from the UI), not purged. " +
        "Zip Station has no separate manual 'archive' action, so use this to remove or archive a story.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Story card number (e.g. 23 for STR-23)."),
      },
    },
    async ({ companyId, projectId, cardNumber }) => {
      const story = await resolveStory(companyId, projectId, cardNumber);
      await api.delete<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}`
      );
      return {
        content: [
          { type: "text" as const, text: `Deleted story STR-${cardNumber} (${story.id}).` },
        ],
      };
    }
  );

  server.registerTool(
    "set_story_priority",
    {
      title: "Set story priority (bulk)",
      description:
        "Set the priority of one or more kanban stories in a project. Provide the target priority plus the card " +
        "numbers to change (e.g. [23, 24] for STR-23, STR-24). Each story is updated independently — the result " +
        "reports per-story success/failure, so one bad card number does not abort the batch.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the stories belong to. All target stories must be in this project."),
        priority: z.enum(STORY_PRIORITIES).describe("Target priority to apply to every listed story."),
        cardNumbers: z
          .array(z.number().int().positive())
          .min(1)
          .describe("Card numbers to update (e.g. [23, 24] for STR-23, STR-24)."),
      },
    },
    async ({ companyId, projectId, priority, cardNumbers }) => {
      const results: Array<{ cardNumber: number; storyId?: string; ok: boolean; error?: string }> = [];
      for (const cardNumber of cardNumbers) {
        try {
          const story = await resolveStory(companyId, projectId, cardNumber);
          await api.patch<unknown>(
            `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}`,
            { priority }
          );
          results.push({ cardNumber, storyId: story.id, ok: true });
        } catch (err) {
          results.push({ cardNumber, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      const updated = results.filter((r) => r.ok).length;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ priority, updated, total: cardNumbers.length, results }, null, 2),
          },
        ],
      };
    }
  );

  server.registerTool(
    "link_ticket_to_story",
    {
      title: "Link a ticket to a story",
      description:
        "Link a support ticket to a kanban story so the story tracks that ticket. Identify the story by card number " +
        "(e.g. 23 for STR-23) and the ticket by its number (e.g. 6) or internal ID. Returns the updated story card.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Story card number (e.g. 23 for STR-23)."),
        ticketIdOrNumber: z.string().describe("Ticket number (e.g. '6') or internal ticket ID to link."),
      },
    },
    async ({ companyId, projectId, cardNumber, ticketIdOrNumber }) => {
      const story = await resolveStory(companyId, projectId, cardNumber);
      const updated = await api.post<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}/link-ticket`,
        { ticketIdOrNumber }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "unlink_ticket_from_story",
    {
      title: "Unlink a ticket from a story",
      description:
        "Remove a ticket link from a kanban story. Identify the story by card number (e.g. 23 for STR-23) and the ticket " +
        "by its internal ID (from the story's linkedTicketIds — see get_story). Returns the updated story card.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the story belongs to."),
        cardNumber: z.number().int().positive().describe("Story card number (e.g. 23 for STR-23)."),
        ticketId: z.string().describe("Internal ticket ID to unlink (from the story's linkedTicketIds)."),
      },
    },
    async ({ companyId, projectId, cardNumber, ticketId }) => {
      const story = await resolveStory(companyId, projectId, cardNumber);
      const updated = await api.delete<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}/link-ticket/${encodeURIComponent(ticketId)}`
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated ?? `Unlinked ticket ${ticketId} from STR-${cardNumber}.`, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "link_story_to_story",
    {
      title: "Link a story to another story",
      description:
        "Create a link between two kanban stories. Identify the source story by card number (e.g. 23 for STR-23) and the " +
        "other story by its card number or internal ID. Returns the updated source story card.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the stories belong to."),
        cardNumber: z.number().int().positive().describe("Source story card number (e.g. 23 for STR-23)."),
        otherCardIdOrNumber: z.string().describe("The other story's card number (e.g. '42') or internal ID to link."),
      },
    },
    async ({ companyId, projectId, cardNumber, otherCardIdOrNumber }) => {
      const story = await resolveStory(companyId, projectId, cardNumber);
      const updated = await api.post<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}/link-story`,
        { cardIdOrNumber: otherCardIdOrNumber }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "unlink_story_from_story",
    {
      title: "Unlink a story from another story",
      description:
        "Remove a link between two kanban stories. Identify both stories by card number (e.g. 23 for STR-23). " +
        "Returns the updated source story card.",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project the stories belong to."),
        cardNumber: z.number().int().positive().describe("Source story card number (e.g. 23 for STR-23)."),
        otherCardNumber: z.number().int().positive().describe("The other story's card number to unlink."),
      },
    },
    async ({ companyId, projectId, cardNumber, otherCardNumber }) => {
      const [story, other] = await Promise.all([
        resolveStory(companyId, projectId, cardNumber),
        resolveStory(companyId, projectId, otherCardNumber),
      ]);
      const updated = await api.delete<unknown>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/cards/${encodeURIComponent(story.id)}/link-story/${encodeURIComponent(other.id)}`
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(updated ?? `Unlinked STR-${otherCardNumber} from STR-${cardNumber}.`, null, 2) },
        ],
      };
    }
  );

  server.registerTool(
    "update_columns",
    {
      title: "Update board columns (states)",
      description:
        "Replace a project board's full set of columns (states) — use this to rename, recolor, reorder, add, or remove " +
        "columns. This is a full replacement: ALWAYS call get_board first, then send the COMPLETE desired column list. " +
        "Keep the `id` of every column you want to preserve (and its cards); omit `id` to create a new column. The order " +
        "of the array is the board order. A column cannot be removed while it still holds cards. `resolvedColumnId` sets " +
        "which column marks stories resolved (must match one of the columns' IDs).",
      inputSchema: {
        companyId: z.string().describe("Zip Station company ID."),
        projectId: z.string().describe("Project whose board to update."),
        columns: z
          .array(
            z.object({
              id: z.string().optional().describe("Existing column ID to preserve it. Omit to create a new column."),
              name: z.string().min(1).describe("Column (state) name."),
              color: z.string().optional().describe("Optional color (hex or named)."),
            })
          )
          .min(1)
          .describe("The complete, ordered list of columns the board should have."),
        resolvedColumnId: z.string().describe("ID of the column that marks stories as resolved. Must be one of the columns above (use an existing column's id)."),
      },
    },
    async ({ companyId, projectId, columns, resolvedColumnId }) => {
      const board = await api.put<KanbanBoard>(
        `/api/v1/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/board/columns`,
        { columns, resolvedColumnId }
      );
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(board, null, 2) },
        ],
      };
    }
  );
}
