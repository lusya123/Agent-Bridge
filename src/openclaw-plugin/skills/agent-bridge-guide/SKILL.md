---
name: agent-bridge-guide
description: |
  跨机器 Agent 协作指南。当用户需要分发任务到其他机器、多 Agent 协作、或访问远程机器资源时激活。
---

# Agent Bridge — 跨机器 Agent 通信

你有 4 个 Bridge 工具可以与其他机器上的 Agent 协作。

## 什么时候该用 Bridge

| 场景 | 使用 Bridge？ |
|------|-------------|
| 任务太重，需要分发到多台机器并行处理 | 是 |
| 需要访问其他机器上的资源或服务 | 是 |
| 需要多个 Agent 协作完成复杂任务 | 是 |
| 简单的本地任务，自己能完成 | 否 |

## 典型工作流

### 1. 查看集群状态

```json
bridge_agents {}
```

了解当前有哪些 Agent 在运行，哪些机器有空闲资源。

### 2. 创建 Worker Agent

```json
bridge_spawn {
  "agent_id": "researcher-1",
  "task": "搜索并整理关于 AI Agent 架构的最新论文"
}
```

`agent_id` 全局唯一，建议用语义化命名（如 `researcher-1`、`coder-backend`）。

### 3. 发送指令

```json
bridge_message {
  "agent_id": "researcher-1",
  "message": "重点关注 2024 年之后的论文，整理成表格格式"
}
```

消息会自动路由——无论目标 Agent 在本机还是远程机器。

### 4. 检查进度

定期调用 `bridge_agents` 查看 Worker 状态。

### 5. 清理 Worker

```json
bridge_stop {
  "agent_id": "researcher-1"
}
```

任务完成后及时清理，释放资源。

## 注意事项

- **agent_id 全局唯一**：不要用已存在的 ID 创建新 Agent
- **message 要清晰**：描述清楚任务目标、输出格式、截止条件
- **及时清理**：完成后用 `bridge_stop` 释放资源
- **错误处理**：如果返回 `ok: false`，检查 `error_code` 和 `detail`
