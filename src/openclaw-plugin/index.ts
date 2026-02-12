import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, jsonResult } from "openclaw/plugin-sdk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const BRIDGE_ENDPOINT =
  process.env.AGENT_BRIDGE_ENDPOINT || "http://127.0.0.1:9100";

/** Read secret from persisted token file or env var */
function getBridgeSecret(): string | null {
  if (process.env.AGENT_BRIDGE_SECRET) return process.env.AGENT_BRIDGE_SECRET;
  const tokenFile = join(homedir(), ".agent-bridge", "token");
  if (existsSync(tokenFile)) {
    const token = readFileSync(tokenFile, "utf-8").trim();
    const atIdx = token.indexOf("@");
    return atIdx !== -1 ? token.slice(0, atIdx) : token;
  }
  return null;
}

async function bridgeFetch(path: string, options?: RequestInit) {
  try {
    const secret = getBridgeSecret();
    const headers = new Headers(options?.headers);
    if (secret) headers.set("Authorization", `Bearer ${secret}`);
    const res = await fetch(`${BRIDGE_ENDPOINT}${path}`, { ...options, headers });
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
        "查看本机和集群中所有运行中的 Agent 列表。返回集群视图，按机器分组显示每台机器上的 agent。",
      parameters: { type: "object", properties: {} },
      async execute() {
        return bridgeFetch("/agents?scope=cluster");
      },
    });

    api.registerTool({
      name: "bridge_spawn",
      description:
        "委托任务给本机或远程机器的 Agent，期待对方完成后返回结果。自动创建独立子会话并注入回调指令。适用场景：需要对方执行任务并汇报结果（如\"检查是否运行了 newapi\"、\"分析日志找出错误\"）。",
      parameters: {
        type: "object",
        properties: {
          agent_id: {
            type: "string",
            description: "Agent ID。已有 agent 直接复用（如 main），新 agent 需设 create_agent=true",
          },
          task: {
            type: "string",
            description: "分配给 Agent 的任务描述",
          },
          type: {
            type: "string",
            description: "Agent 类型，默认 openclaw",
          },
          machine: {
            type: "string",
            description: "目标机器 ID（如 cloud-b）。不填则在本机创建",
          },
          session_key: {
            type: "string",
            description: "子会话 key（如 task-123）。为已有 agent 创建独立子会话",
          },
          create_agent: {
            type: "boolean",
            description: "是否在 Gateway 动态创建新 agent 定义。agent_id 是全新 ID 时设为 true",
          },
          callback: {
            type: "boolean",
            description: "是否注入回调指令让 spawned agent 完成后自动汇报结果。默认 true",
          },
        },
        required: ["agent_id", "task"],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        // Build callback info (default: enabled)
        let callbackInfo = undefined;
        if (params.callback !== false) {
          try {
            const secret = getBridgeSecret();
            const infoHeaders: Record<string, string> = {};
            if (secret) infoHeaders["Authorization"] = `Bearer ${secret}`;
            const infoRes = await fetch(`${BRIDGE_ENDPOINT}/info`, { headers: infoHeaders });
            const info = (await infoRes.json()) as { machine_id: string };
            callbackInfo = {
              caller_agent_id: "main",
              caller_machine: info.machine_id,
            };
          } catch {
            /* skip callback if /info fails */
          }
        }

        return bridgeFetch("/spawn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            agent_id: params.agent_id,
            task: params.task,
            type: params.type || "openclaw",
            machine: params.machine,
            session_key: params.session_key,
            create_agent: params.create_agent,
            callback: callbackInfo,
          }),
        });
      },
    });

    api.registerTool({
      name: "bridge_message",
      description:
        "单向发送消息给本机或远程机器的 Agent，不期待返回结果。适用场景：通知、协调、传递信息（如\"我已完成部署\"、\"准备接收数据\"），或回传任务结果（被 spawn 的 agent 用来回调）。",
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
          machine: {
            type: "string",
            description: "目标机器 ID。指定后直接发到该机器，不走自动路由。回调场景或两台机器有同名 agent 时必须指定",
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
            machine: params.machine,
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
