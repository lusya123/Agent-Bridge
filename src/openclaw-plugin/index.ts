import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, jsonResult } from "openclaw/plugin-sdk";

const BRIDGE_ENDPOINT =
  process.env.AGENT_BRIDGE_ENDPOINT || "http://127.0.0.1:9100";

async function bridgeFetch(path: string, options?: RequestInit) {
  try {
    const res = await fetch(`${BRIDGE_ENDPOINT}${path}`, options);
    const data = await res.json();
    if (!res.ok) {
      return jsonResult({
        ok: false,
        error_code: data.error_code || "BRIDGE_ERROR",
        detail: data.detail || data.error || res.statusText,
      });
    }
    return jsonResult({ ok: true, ...data });
  } catch (err: any) {
    return jsonResult({
      ok: false,
      error_code: "BRIDGE_UNREACHABLE",
      detail: `Cannot reach Bridge at ${BRIDGE_ENDPOINT}: ${err.message}`,
    });
  }
}

const plugin = {
  id: "agent-bridge",
  name: "Agent Bridge",
  description: "跨机器 Agent 通信工具",
  configSchema: emptyPluginConfigSchema(),

  register(api: OpenClawPluginApi) {
    api.registerTool({
      name: "bridge_agents",
      description:
        "查看本机和集群中所有运行中的 Agent 列表。用于了解当前有哪些 Agent 在运行、它们的状态和类型。",
      parameters: { type: "object", properties: {} },
      async execute() {
        return bridgeFetch("/agents");
      },
    });

    api.registerTool({
      name: "bridge_spawn",
      description:
        "在本机或远程机器创建新 Agent。当你需要把任务分配给其他 Agent，或者需要在其他机器上并行处理任务时使用。创建后用 bridge_message 发送指令。",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "新 Agent 的唯一 ID，如 worker-1、researcher 等",
          },
          task: {
            type: "string",
            description: "分配给 Agent 的任务描述",
          },
          type: {
            type: "string",
            description: "Agent 类型，默认 openclaw",
          },
        },
        required: ["agent_id", "task"],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        return bridgeFetch("/spawn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: params.agent_id,
            task: params.task,
            type: params.type || "openclaw",
          }),
        });
      },
    });

    api.registerTool({
      name: "bridge_message",
      description:
        "给任意 Agent 发消息，自动路由到本机或远程机器。用于给其他 Agent 发送指令、传递信息或协调任务。",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "目标 Agent ID",
          },
          message: {
            type: "string",
            description: "要发送的消息内容",
          },
        },
        required: ["agent_id", "message"],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        return bridgeFetch("/message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: params.agent_id,
            message: params.message,
          }),
        });
      },
    });

    api.registerTool({
      name: "bridge_stop",
      description:
        "停止指定 Agent。任务完成后用于清理不再需要的 Agent。",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "要停止的 Agent ID",
          },
        },
        required: ["agent_id"],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        return bridgeFetch("/stop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_id: params.agent_id }),
        });
      },
    });
  },
};

export default plugin;
