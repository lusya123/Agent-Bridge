# Phase 5: OpenClaw Plugin — 需求文档

## 背景

Agent Bridge 的核心通信功能已完成并通过两台云服务器真机验证（spawn/message/stop/跨机器通信全部通过，77 单元测试 + 17 集成测试）。但 OpenClaw Agent 目前不知道 Bridge 的存在，无法主动调用。

**目标**：让用户运行 `agent-bridge install` 后，OpenClaw Agent 立刻获得跨机器通信能力——工具自动出现在 agent 工具列表中，agent 知道什么时候该用、怎么用。运行 `agent-bridge uninstall` 后干净移除。

## 技术方案

### 方案选型

OpenClaw 提供多种扩展机制，经过分析选择 **Plugin + Skill** 组合：

- **Plugin**（必须）：注册原生工具，agent 的工具列表自动出现 `bridge_*` 工具
- **Skill**（随 Plugin 打包）：教 agent 什么场景该用、怎么组合使用
- **AGENTS.md**（不需要）：Plugin 注册的工具自动可见，不需要额外写 prompt

### 整体架构

```
用户运行 agent-bridge install
  ↓
复制 plugin 文件到 ~/.openclaw/extensions/agent-bridge/
  ↓
OpenClaw Gateway 重启后自动发现插件
  ↓
Agent 工具列表出现: bridge_agents, bridge_spawn, bridge_message, bridge_stop
  ↓
Agent 通过 Telegram/其他渠道收到用户指令
  ↓
Agent 调用 bridge_spawn → fetch("http://127.0.0.1:9100/spawn", ...)
  ↓
Bridge 路由到本机或远程机器执行
```

## 要创建的文件

### 1. Plugin 入口 — `src/openclaw-plugin/index.ts`

注册 4 个工具：

| 工具名 | 对应 Bridge API | description（agent 看到的） |
|--------|----------------|--------------------------|
| `bridge_agents` | `GET /agents` | 查看本机和集群中所有运行中的 Agent 列表。用于了解当前有哪些 Agent 在运行、它们的状态和类型。 |
| `bridge_spawn` | `POST /spawn` | 在本机或远程机器创建新 Agent。当你需要把任务分配给其他 Agent，或者需要在其他机器上并行处理任务时使用。创建后用 bridge_message 发送指令。 |
| `bridge_message` | `POST /message` | 给任意 Agent 发消息，自动路由到本机或远程机器。用于给其他 Agent 发送指令、传递信息或协调任务。 |
| `bridge_stop` | `POST /stop` | 停止指定 Agent。任务完成后用于清理不再需要的 Agent。 |

**工具参数**：

```typescript
// bridge_agents — 无参数
parameters: Type.Object({})

// bridge_spawn
parameters: Type.Object({
  agent_id: Type.String({ description: "新 Agent 的唯一 ID，如 worker-1、researcher 等" }),
  task: Type.String({ description: "分配给 Agent 的任务描述" }),
  type: Type.Optional(Type.String({ description: "Agent 类型，默认 openclaw" })),
})

// bridge_message
parameters: Type.Object({
  agent_id: Type.String({ description: "目标 Agent ID" }),
  message: Type.String({ description: "要发送的消息内容" }),
})

// bridge_stop
parameters: Type.Object({
  agent_id: Type.String({ description: "要停止的 Agent ID" }),
})
```

**实现方式**：每个工具内部用 `fetch()` 调用 Bridge HTTP API。

**Endpoint 配置**：`process.env.AGENT_BRIDGE_ENDPOINT || "http://127.0.0.1:9100"`

**返回格式**：用 `jsonResult()` 包装 Bridge API 的 JSON 响应。错误时也返回 JSON（包含 error_code 和 detail）。

**导入方式**：
```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema, jsonResult } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
```

**导出格式**（对象风格，参考 memory-core 插件）：
```typescript
const plugin = {
  id: "agent-bridge",
  name: "Agent Bridge",
  description: "跨机器 Agent 通信工具",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    api.registerTool({ name: "bridge_agents", ... });
    api.registerTool({ name: "bridge_spawn", ... });
    api.registerTool({ name: "bridge_message", ... });
    api.registerTool({ name: "bridge_stop", ... });
  },
};
export default plugin;
```

### 2. 插件清单 — `src/openclaw-plugin/openclaw.plugin.json`

```json
{
  "id": "agent-bridge",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {}
  },
  "skills": ["./skills/agent-bridge-guide"]
}
```

### 3. 包描述 — `src/openclaw-plugin/package.json`

```json
{
  "name": "@agent-bridge/openclaw-plugin",
  "version": "0.1.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  }
}
```

### 4. Skill 使用指南 — `src/openclaw-plugin/skills/agent-bridge-guide/SKILL.md`

YAML frontmatter + Markdown 内容，包括：
- 什么时候该用 Bridge（任务太重需要分发、需要多 agent 协作、需要访问其他机器资源）
- 典型工作流：
  1. `bridge_agents` 查看集群状态
  2. `bridge_spawn` 在空闲机器创建 worker
  3. `bridge_message` 给 worker 发任务
  4. 定期 `bridge_agents` 检查 worker 状态
  5. 完成后 `bridge_stop` 清理 worker
- 注意事项：agent_id 全局唯一、message 要描述清楚任务

### 5. CLI 子命令 — 修改 `src/cli.ts`

新增 install / uninstall / start 子命令：

```
agent-bridge install    → 复制 plugin 目录到 ~/.openclaw/extensions/agent-bridge/
agent-bridge uninstall  → 删除 ~/.openclaw/extensions/agent-bridge/
agent-bridge start      → 启动服务（自动检测未 install 则先 install）
agent-bridge [无参数]   → 等同于 start（向后兼容）
```

**install 逻辑**：
1. 检查 `~/.openclaw/` 目录是否存在（判断 OpenClaw 是否安装）
2. 如果不存在，报错提示先安装 OpenClaw
3. 创建 `~/.openclaw/extensions/agent-bridge/` 目录（递归创建）
4. 复制 `src/openclaw-plugin/` 下所有文件（index.ts, openclaw.plugin.json, package.json, skills/）到目标
5. 打印成功信息 + 提示重启 OpenClaw Gateway

**uninstall 逻辑**：
1. 删除 `~/.openclaw/extensions/agent-bridge/` 整个目录（递归删除）
2. 打印成功信息

**start 逻辑**：
1. 自动检测 `~/.openclaw/extensions/agent-bridge/` 是否存在
2. 不存在 + `~/.openclaw/` 存在 → 自动 install
3. 启动 Bridge 服务（现有逻辑）

## OpenClaw Plugin 规范参考

以下信息来自 OpenClaw 源码分析（`/Users/xuehongyu/Downloads/openclaw-main 3`）：

### 插件发现机制
- 文件：`src/plugins/discovery.ts`
- 搜索路径（优先级）：workspace `.openclaw/extensions/` > global `~/.openclaw/extensions/` > bundled
- 识别方式：目录下有 `package.json`（含 `openclaw.extensions` 字段）或 `index.ts`

### 工具注册 API
- 文件：`src/plugins/types.ts`
- `api.registerTool(toolDef, options?)` — toolDef 需要 name, description, parameters, execute
- Agent 看到：name + description + parameters schema（包括每个字段的 description）
- Agent 看不到：execute 实现代码

### Skill 格式
- 文件名：`SKILL.md`（大写）
- 格式：YAML frontmatter（name, description）+ Markdown 正文
- 在 `openclaw.plugin.json` 的 `skills` 字段声明路径

### 工具返回格式
- 文件：`src/agents/tools/common.ts`
- `jsonResult(payload)` 返回 `{ content: [{ type: "text", text: JSON.stringify(payload) }], details: payload }`

### TypeBox
- 包：`@sinclair/typebox`
- 常用：`Type.Object({})`, `Type.String({ description: "" })`, `Type.Optional()`, `Type.Number()`

### 参考插件
- 简单示例：`extensions/memory-core/`（38 行）
- 工具示例：`extensions/lobster/`（含 SKILL.md + tool 定义）
- 飞书示例：`extensions/feishu/`（多工具 + 多 skill）

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/openclaw-plugin/index.ts` | 新建 | 插件入口，注册 4 个工具 |
| `src/openclaw-plugin/openclaw.plugin.json` | 新建 | 插件清单 |
| `src/openclaw-plugin/package.json` | 新建 | 包描述 |
| `src/openclaw-plugin/skills/agent-bridge-guide/SKILL.md` | 新建 | 使用指南 |
| `src/cli.ts` | 修改 | 添加 install/uninstall/start 子命令 |
| `CLAUDE.md` | 修改 | 新增 Plugin 相关说明 |
| `CHANGELOG.md` | 修改 | 记录 Phase 5 |

## 验证方法

1. `npm test` — 现有 77 个测试不被破坏
2. `agent-bridge install` — 检查 `~/.openclaw/extensions/agent-bridge/` 文件正确
3. `agent-bridge uninstall` — 确认目录被完整删除
4. 真机验证（Server A）：
   - 安装插件 → 重启 Gateway → Telegram 让 agent 调用 `bridge_agents`
   - 让 agent 调用 `bridge_spawn` 在 Server B 创建 agent
