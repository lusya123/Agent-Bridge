# OpenClaw Gateway — Agent Bridge 适配器参考

## 概述

OpenClaw 是一个 AI Agent 框架，Gateway 是其核心服务进程，提供 WebSocket 控制面 + 事件总线。
Agent Bridge 通过 WebSocket 连接 Gateway 来管理 OpenClaw Agent。

## 部署信息

- **端口**：18789（默认）
- **绑定地址**：`127.0.0.1:18789`（仅本机）
- **WebSocket URL**：`ws://127.0.0.1:18789`
- **认证**：需要 token（`OPENCLAW_GATEWAY_TOKEN` 或 `gateway.auth.token`）
- **启动命令**：`openclaw gateway --port 18789`
- **状态检查**：`openclaw gateway status`
- **日志**：`openclaw logs --follow`

## WebSocket 协议

### 帧格式

- **请求**：`{type: "req", id: "...", method: "...", params: {...}}`
- **响应**：`{type: "res", id: "...", ok: true|false, payload: {...} | error: {...}}`
- **事件**：`{type: "event", event: "...", payload: {...}}`

### 连接握手（必须）

连接后第一帧必须是 `connect` 请求：

```json
{
  "type": "req",
  "id": "1",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "agent-bridge",
      "version": "0.1.0",
      "platform": "linux",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "auth": { "token": "<OPENCLAW_GATEWAY_TOKEN>" }
  }
}
```

成功响应：
```json
{
  "type": "res",
  "id": "1",
  "ok": true,
  "payload": { "type": "hello-ok", "protocol": 3, ... }
}
```

### Agent Bridge 使用的 RPC 方法

#### 1. `sessions.list` — 列出 Agent

请求：
```json
{"type": "req", "id": "2", "method": "sessions.list", "params": {}}
```

响应：
```json
{"type": "res", "id": "2", "ok": true, "payload": [
  {"id": "ceo", "status": "running", "persistent": true, "task": "..."}
]}
```

#### 2. `agent` — 发送消息 / 创建 Agent

发送消息（idempotencyKey 必填，用于去重）：
```json
{"type": "req", "id": "3", "method": "agent", "params": {
  "agentId": "ceo", "message": "hello", "idempotencyKey": "<uuid>"
}}
```

创建新 Agent（发消息到新 agentId 即自动创建 session）：
```json
{"type": "req", "id": "4", "method": "agent", "params": {
  "agentId": "worker-1", "message": "do task X", "idempotencyKey": "<uuid>"
}}
```

**注意**：`from` 和 `newSession` 不是合法参数（additionalProperties: false），客户端身份通过 connect 握手获得。

**注意**：`agent` 方法是两阶段响应：
1. 先返回 ack：`{ok: true, payload: {runId: "...", status: "accepted"}}`
2. 然后通过 event 流式输出：`{type: "event", event: "agent", payload: {...}}`
3. 最后返回 final：`{ok: true, payload: {runId: "...", status: "ok", summary: "..."}}`

#### 3. `sessions.delete` / `sessions.reset` — 停止 Agent

删除 session（非 main session）：
```json
{"type": "req", "id": "5", "method": "sessions.delete", "params": {"key": "agent:worker-1:main"}}
```

重置 session（main session 不可删除，用 reset 替代）：
```json
{"type": "req", "id": "5", "method": "sessions.reset", "params": {"key": "agent:main:main"}}
```

**注意**：需要 `operator.admin` scope。session key 格式为 `agent:<agentId>:<sessionKey>`。

### 错误格式

```json
{"type": "res", "id": "...", "ok": false, "error": {
  "code": "AGENT_TIMEOUT", "message": "...", "retryable": false
}}
```

## 适配器实现要点

1. **请求帧格式**：必须包含 `type: "req"` 字段
2. **连接握手**：WebSocket 连接后必须发 `connect` 请求（含 auth token）
3. **响应格式**：`{type:"res", id, ok, payload|error}`
4. **两阶段 agent 响应**：`agent` 方法先 ack 再 final。spawn/message 操作 ack 即可 resolve
5. **sessions.list 返回格式**：`{sessions:[{key:"agent:main:main",...}]}`，用 `key` 而非 `id`
6. **停止 Agent**：使用 `sessions.delete`（main session 降级为 `sessions.reset`），需要 `operator.admin` scope
7. **客户端身份**：`id: 'gateway-client'`, `mode: 'backend'`（Gateway 校验固定集合）
