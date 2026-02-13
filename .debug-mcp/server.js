#!/usr/bin/env node

/**
 * AgentCockpit Debug MCP Server
 *
 * Bridges MCP tool calls to the app's HTTP debug bridge (localhost:19876).
 * Run with: node .debug-mcp/server.js
 *
 * Designed for Claude Code to interact with the running app.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BRIDGE_URL = "http://127.0.0.1:19876/invoke";

// =====================================================
// HTTP bridge helper
// =====================================================

async function bridgeInvoke(action, params = {}) {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params }),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  } catch (err) {
    return {
      error: `Bridge connection failed: ${err.message}. Is the app running in dev mode?`,
    };
  }
}

// =====================================================
// Tool definitions
// =====================================================

const TOOLS = [
  {
    name: "app_state",
    description:
      "Get the current application state (projects, active project, settings). No parameters needed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "git_status",
    description:
      "Get git status for a project (branch, modified files, staged files, untracked).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "git_poll",
    description:
      "Force an immediate git watcher poll. Triggers status/changed/commit events if state changed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "index_stats",
    description:
      "Get DeltaCodeCube index stats for a project (total files, score, grade, distribution).",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "force_reindex",
    description: "Force a full DeltaCodeCube reindex of a project.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "create_snapshot",
    description:
      "Create a new git snapshot (versioned commit + tag) for a project.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "list_snapshots",
    description: "List all snapshots for a project.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Absolute path to the project directory",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "capture_events",
    description:
      "Capture events from an event bus for a specified duration. Useful for debugging async flows.",
    inputSchema: {
      type: "object",
      properties: {
        bus: {
          type: "string",
          enum: ["gitWatcher", "index"],
          description: "Which event bus to listen to",
        },
        event: {
          type: "string",
          description:
            "Event name (gitWatcher: status|changed|commit|error; index: indexing|indexed|error|tensions_detected)",
        },
        duration_ms: {
          type: "number",
          description: "How long to capture in milliseconds (default 5000)",
        },
      },
      required: ["bus", "event"],
    },
  },
  {
    name: "invoke",
    description:
      "Invoke any debug action directly. Use for actions not covered by specific tools. Run with action='help' to see available actions.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Action name (e.g. 'state.get', 'git.status', 'dcc.getIndexStats')",
        },
        params: {
          type: "object",
          description: "Parameters for the action",
        },
      },
      required: ["action"],
    },
  },
];

// =====================================================
// Tool handlers
// =====================================================

const TOOL_HANDLERS = {
  app_state: async () => bridgeInvoke("state.get"),

  git_status: async ({ path }) => bridgeInvoke("git.status", { path }),

  git_poll: async () => bridgeInvoke("gitWatcher.pollNow"),

  index_stats: async ({ path }) => bridgeInvoke("dcc.getIndexStats", { path }),

  force_reindex: async ({ path }) =>
    bridgeInvoke("dcc.reindexProject", { path }),

  create_snapshot: async ({ path }) =>
    bridgeInvoke("snapshot.create", { path }),

  list_snapshots: async ({ path }) => bridgeInvoke("snapshot.list", { path }),

  capture_events: async ({ bus, event, duration_ms }) => {
    // capture_events needs a special two-step approach:
    // 1. Start capture via the bridge
    // 2. Wait for duration then collect
    // The bridge _invoke routes this to the JS captureEvents helper
    const busMap = { gitWatcher: "gitWatcher", index: "index" };
    const busName = busMap[bus];
    if (!busName) return { error: `Unknown bus: ${bus}` };

    // We invoke a special action that the _invoke router handles
    return bridgeInvoke("_captureEvents", {
      bus: busName,
      event,
      durationMs: duration_ms || 5000,
    });
  },

  invoke: async ({ action, params }) =>
    bridgeInvoke(action, params || {}),
};

// =====================================================
// Server setup
// =====================================================

const server = new Server(
  { name: "agentcockpit-debug", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) },
      ],
    };
  }

  const result = await handler(args || {});

  return {
    content: [
      {
        type: "text",
        text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
      },
    ],
  };
});

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
