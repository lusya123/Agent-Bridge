# Phase 5.5: Cross-Machine Agent/Subagent Creation + Callback

## Context

Phase 5 E2E 验证发现两个问题：
1. `bridge_spawn` 无法在 Server B 创建 agent — Gateway 拒绝未预配置的 agentId（`unknown agent id`）
2. `bridge_message` 无法指定目标机器 — 两台机器都有 `main` agent，跨机器回调消息总是被本地拦截

探索 OpenClaw Gateway 源码（`/Users/xuehongyu/Downloads/openclaw-main 3/`）发现三个关键能力：
- **`agents.create` RPC**（`src/gateway/server-methods/agents.ts:185-256`）— 动态创建新 agent，params: `name`(必填) + `workspace`(必填)
- **`sessionKey` 自动建 session**（`src/gateway/server-methods/agent.ts:214-297`）— `agent` RPC 传新 sessionKey 自动创建 session，格式 `agent:<agentId>:<key>`
- **`extraSystemPrompt`**（`src/gateway/protocol/schema/agent.ts:66`）— 可选参数，注入到系统提示词的 "Subagent Context" 部分

## 需要改动的文件（7 个）

| 文件 | 改动 |
|------|------|
| `src/adapters/types.ts` | SpawnOptions 新增 3 个字段 |
| `src/adapters/openclaw.ts` | spawnAgent 增强 + injectCallback 方法 |
| `src/router.ts` | deliver() 新增 targetMachine 参数 |
| `src/api/message.ts` | 透传 machine 参数 |
| `src/api/spawn.ts` | 不需要改（SpawnOptions 类型自动透传） |
| `src/openclaw-plugin/index.ts` | bridge_spawn / bridge_message 新增参数 |
| 测试文件 | router / message / spawn 测试 |

---

## 详细改动

### 1. `src/adapters/types.ts` — SpawnOptions 新增字段

当前 SpawnOptions（第 10-17 行）：
```typescript
export interface SpawnOptions {
  type: 'openclaw' | 'claude-code' | 'generic';
  agent_id: string;
  task: string;
  machine?: string;
  persistent?: boolean;
  heartbeat?: Record<string, string>;
}
```

新增 3 个字段：
```typescript
export interface SpawnOptions {
  type: 'openclaw' | 'claude-code' | 'generic';
  agent_id: string;
  task: string;
  machine?: string;
  persistent?: boolean;
  heartbeat?: Record<string, string>;
  // --- 新增 ---
  session_key?: string;       // 子会话 key（如 "task-123"），为已有 agent 创建独立 session
  create_agent?: boolean;     // 动态创建新 agent 定义（Gateway agents.create RPC）
  callback?: {                // 回调信息，注入到 task 消息末尾
    caller_agent_id: string;  // 回调目标 agent
    caller_machine: string;   // 回调目标机器
  };
}
```

### 2. `src/adapters/openclaw.ts` — 核心逻辑

#### 2a. spawnAgent 方法重写（替换当前第 238-245 行）

```typescript
async spawnAgent(options: SpawnOptions): Promise<string> {
  // Step 1: 动态创建 agent（如果需要）
  if (options.create_agent) {
    try {
      await this.rpc('agents.create', {
        name: options.agent_id,
        workspace: '/tmp',
      });
      log.info('OpenClaw', `Created new agent: ${options.agent_id}`);
    } catch (err) {
      // 如果 agent 已存在，忽略错误继续
      if (err instanceof Error && err.message.includes('already exists')) {
        log.debug('OpenClaw', `Agent ${options.agent_id} already exists, skipping create`);
      } else {
        throw err;
      }
    }
  }

  // Step 2: 构建消息（注入回调指令）
  let message = options.task;
  if (options.callback) {
    message = this.injectCallback(message, options.callback);
  }

  // Step 3: 构建 RPC 参数
  const params: Record<string, unknown> = {
    agentId: options.agent_id,
    message,
    idempotencyKey: randomUUID(),
  };

  // sessionKey: 指定则用指定的，否则自动生成唯一 key（避免污染主 session）
  if (options.session_key) {
    params.sessionKey = `agent:${options.agent_id}:${options.session_key}`;
  } else {
    // 默认为每次 spawn 创建独立 session
    params.sessionKey = `agent:${options.agent_id}:spawn-${randomUUID().slice(0, 8)}`;
  }

  await this.rpc('agent', params, { twoPhase: true, resolveOnAck: true });
  return options.agent_id;
}
```

#### 2b. 新增 injectCallback 私有方法

```typescript
private injectCallback(
  task: string,
  callback: { caller_agent_id: string; caller_machine: string },
): string {
  return task + [
    '',
    '',
    '---',
    '## 回调指令（Callback Instructions）',
    '完成任务后，你**必须**使用 `bridge_message` 工具将结果发回给调用者：',
    `- agent_id: "${callback.caller_agent_id}"`,
    `- machine: "${callback.caller_machine}"`,
    '- message: 你的任务结果摘要',
    '',
    '不要跳过回调。调用者正在等待你的结果。',
    '---',
  ].join('\n');
}
```

### 3. `src/router.ts` — deliver() 新增 targetMachine 参数

当前签名（第 13 行）：
```typescript
async deliver(agentId: string, from: string, message: string): Promise<void> {
```

修改为：
```typescript
async deliver(agentId: string, from: string, message: string, targetMachine?: string): Promise<void> {
  log.debug('Router', `Delivering message to ${agentId} from ${from}` +
    (targetMachine ? ` (target: ${targetMachine})` : ''));

  // 如果指定了 targetMachine 且不是本机，直接转发（不查本地）
  if (targetMachine && targetMachine !== this.config.machine_id) {
    const machine = this.cluster.machines.find((m) => m.id === targetMachine);
    if (!machine) {
      throw new BridgeError({
        status: 404,
        errorCode: ErrorCode.MACHINE_NOT_FOUND,
        message: `Machine "${targetMachine}" not found in cluster`,
      });
    }
    const res = await fetch(`${machine.bridge}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 注意：转发时不含 machine 字段，防止循环
      body: JSON.stringify({ agent_id: agentId, from, message }),
    });
    if (!res.ok) {
      let remoteDetail = `${machine.id}: /message returned ${res.status}`;
      try {
        const data = await res.json() as { error_code?: string; error?: string; detail?: string };
        const pieces = [data.error_code, data.error, data.detail].filter(Boolean);
        if (pieces.length > 0) remoteDetail = `${remoteDetail} (${pieces.join(' | ')})`;
      } catch { /* keep status-only detail */ }
      throw new BridgeError({
        status: 502,
        errorCode: ErrorCode.REMOTE_UNREACHABLE,
        message: `Failed to deliver message to "${agentId}" on ${targetMachine}`,
        detail: remoteDetail,
      });
    }
    return;
  }

  // 原有逻辑不变：先查本地 adapter，再查集群
  // ... （第 16-89 行保持不变）
}
```

### 4. `src/api/message.ts` — 透传 machine 参数

当前请求 body 类型（第 13-17 行），新增 `machine`：

```typescript
const body = await c.req.json<{
  agent_id?: string;
  from?: string;
  message?: string;
  machine?: string;  // 新增
}>();
```

第 30 行 deliver 调用改为：
```typescript
await router.deliver(body.agent_id, from, body.message, body.machine);
```

### 5. `src/api/spawn.ts` — 不需要改代码

当前第 15 行 `body` 已经是 `Partial<SpawnOptions>`，新增的 `session_key`、`create_agent`、`callback` 字段会自动透传到 `adapter.spawnAgent(body as SpawnOptions)`（第 72 行）。

### 6. `src/openclaw-plugin/index.ts` — Plugin 工具更新

#### 6a. bridge_spawn 改造

```typescript
api.registerTool({
  name: "bridge_spawn",
  description:
    "在本机或远程机器创建新 Agent 或子任务。自动注入回调指令，spawned agent 完成后会把结果发回给你。",
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
    // 构建回调信息
    let callbackInfo = undefined;
    if (params.callback !== false) {
      try {
        const infoRes = await fetch(`${BRIDGE_ENDPOINT}/info`);
        const info = await infoRes.json() as { machine_id: string };
        callbackInfo = {
          caller_agent_id: "main",
          caller_machine: info.machine_id,
        };
      } catch { /* skip callback if /info fails */ }
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
```

#### 6b. bridge_message 新增 machine 参数

parameters.properties 里新增：
```typescript
machine: {
  type: "string",
  description: "目标机器 ID。指定后直接发到该机器，不走自动路由。回调场景或两台机器有同名 agent 时必须指定",
},
```

execute 的 body 新增 `machine: params.machine`。

### 7. 测试

#### `test/router.test.ts` 新增：
- targetMachine 指定远程机器 → 跳过本地，直接 HTTP 转发
- targetMachine 指定不存在的机器 → 抛出 MACHINE_NOT_FOUND
- targetMachine 是本机 → 走正常本地查找逻辑
- 转发 body 不含 machine 字段（防循环）

#### `test/api/message.test.ts` 新增：
- 请求含 machine 参数 → 传递到 router.deliver 第 4 参数
- 请求不含 machine → router.deliver 第 4 参数为 undefined

#### `test/api/spawn.test.ts` 新增：
- 请求含 session_key / create_agent / callback → 透传到 adapter.spawnAgent

---

## E2E 场景流程

### 场景 1: Subagent（已有 agent 新建 session）

```
Server A 的 main agent 调用 bridge_spawn:
  { agent_id: "main", task: "搜索 AWS Lambda 最新价格", machine: "cloud-b" }
  ↓
Plugin 获取 /info → caller_machine = "cloud-a"
  ↓
Bridge A /spawn → machine=cloud-b → 转发到 Bridge B /spawn
  ↓
Bridge B OpenClaw adapter:
  1. create_agent = false, 跳过 agents.create
  2. 自动生成 sessionKey = "agent:main:spawn-a1b2c3d4"
  3. task += 回调指令（bridge_message → main, cloud-a）
  4. agent RPC → Gateway 自动创建新 session
  ↓
cloud-b 的 main agent 在新 session 中执行任务
  ↓
完成后调用 bridge_message:
  { agent_id: "main", machine: "cloud-a", message: "结果: ..." }
  ↓
Bridge B /message → machine=cloud-a → 转发到 Bridge A
  ↓
Bridge A 本地投递给 main agent ✅
```

### 场景 2: 全新 Agent

```
Server A 的 main agent 调用 bridge_spawn:
  { agent_id: "researcher", task: "...", machine: "cloud-b", create_agent: true }
  ↓
（同上流程，但 Bridge B 会先调 agents.create 创建 researcher agent）
```

---

## 验证清单

1. `npm test` — 全部通过（含新增测试）
2. `npm run build` — 编译无错误
3. 部署到 Server A (43.134.124.4) 和 Server B (150.109.16.237)
4. E2E 测试 1: bridge_agents 仍然正常
5. E2E 测试 2: bridge_spawn 在 cloud-b 创建 subagent（场景 1）
6. E2E 测试 3: bridge_spawn 在 cloud-b 创建新 agent（场景 2）
7. E2E 测试 4: callback 消息从 cloud-b 回传到 cloud-a
8. E2E 测试 5: bridge_message 带 machine 参数跨机器发送

---

## 服务器信息

- Server A (cloud-a): `root@43.134.124.4` 密码 `2001426xhY!`
  - Gateway token: `a3d55eb1be054e9c38b104c1c6a83dddeabd761dff0dbb34`
  - Bridge 端口: 9100, Gateway 端口: 18789
- Server B (cloud-b): `ubuntu@150.109.16.237` 密码 `2001426xhY!`
  - Gateway token: `936ed3ca0e8af53c3e833473a0084729d9c7dea3d5e5eab0`
  - Bridge 端口: 9100, Gateway 端口: 18789
- 部署方式: `git pull && npm run build && node dist/cli.js install`
- Bridge 启动: `LOG_LEVEL=debug node dist/cli.js start`
- Gateway 重启: `systemctl --user restart openclaw-gateway`
- SSH 工具: `python3 ~/.claude/skills/remote-server-connector/scripts/remote_exec.py`
