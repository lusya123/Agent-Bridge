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

发送消息：
```json
{"type": "req", "id": "3", "method": "agent", "params": {
  "agentId": "ceo", "from": "bridge", "message": "hello"
}}
```

创建新 Agent（newSession: true）：
```json
{"type": "req", "id": "4", "method": "agent", "params": {
  "agentId": "worker-1", "message": "do task X", "newSession": true
}}
```

**注意**：`agent` 方法是两阶段响应：
1. 先返回 ack：`{ok: true, payload: {runId: "...", status: "accepted"}}`
2. 然后通过 event 流式输出：`{type: "event", event: "agent", payload: {...}}`
3. 最后返回 final：`{ok: true, payload: {runId: "...", status: "ok", summary: "..."}}`

#### 3. `sessions.stop` — 停止 Agent

```json
{"type": "req", "id": "5", "method": "sessions.stop", "params": {"agentId": "worker-1"}}
```

### 错误格式

```json
{"type": "res", "id": "...", "ok": false, "error": {
  "code": "AGENT_TIMEOUT", "message": "...", "retryable": false
}}
```

## 当前适配器问题

`src/adapters/openclaw.ts` 的 RPC 实现与真实 Gateway 协议不匹配：

1. **缺少 `type` 字段**：发送 `{id, method, params}` 而非 `{type:"req", id, method, params}`
2. **缺少连接握手**：没有发送 `connect` 请求 + 认证 token
3. **响应解析不匹配**：期望 `{id, result, error}` 而非 `{type:"res", id, ok, payload|error}`
4. **未处理两阶段 agent 响应**：`agent` 方法先返回 ack 再返回 final

这些问题需要在真机测试中修复。
