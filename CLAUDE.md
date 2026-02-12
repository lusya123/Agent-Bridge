# Agent Bridge

分布式 Agent 通信平台 — 让不同框架的 Agent 跨机器协作。

## 项目定位

- 独立项目，不是任何 Agent 框架的插件
- 核心职责：传消息 + 戳一下（心跳），不做业务决策
- 智能在 LLM 里，基础设施只负责通信

## 架构

- 分布式：每台机器运行一个 Bridge 实例（:9100）
- 三层：HTTP API → 路由层（本机/远程转发）→ 适配器层
- 适配器：OpenClaw（WebSocket）、Claude Code（tmux）、通用（预留）
- 网络：Tailscale 组网，机器间直连

## 技术栈

- TypeScript + Node.js
- Hono（HTTP 框架）
- ws（WebSocket 客户端，连 OpenClaw Gateway）

## 关键文件

- `src/index.ts` — 服务入口
- `src/router.ts` — 消息路由（本机直投 / 远程 HTTP 转发）
- `src/adapters/` — 框架适配器
- `config/bridge.example.json` — 本机配置模板
- `config/cluster.example.json` — 集群配置模板
- `doc/Agent-Bridge-完整技术方案.md` — 完整技术方案

## API 端点（6 个）

- `GET  /info` — 机器信息（machine_id, capabilities, resources）
- `GET  /agents` — 当前运行的 Agent 列表
- `GET  /locate?agent_id=xxx` — 定位 Agent 所在机器
- `POST /message` — 发消息给 Agent（本机直投 / 远程转发 / `machine` 定向转发）
- `POST /spawn` — 创建新 Agent（支持跨机器、独立 session、动态创建、回调注入）
- `POST /stop` — 停止 Agent

## 开发命令

- `npm run dev` — 开发模式启动（tsx watch）
- `npm run build` — TypeScript 编译
- `npm test` — 运行测试（vitest）

## OpenClaw Plugin（Phase 5 + 5.5 ✅）

- Plugin 源码：`src/openclaw-plugin/`（install 时复制到 `~/.openclaw/extensions/agent-bridge/`）
- 4 个工具：`bridge_agents`、`bridge_spawn`、`bridge_message`、`bridge_stop`
- Phase 5.5 新增：跨机器 spawn（`machine` 参数）、独立 session、动态创建 agent、回调注入

## 文档

- `doc/README.md` — 文档索引（用户文档、设计文档、项目管理）
- `doc/open-issues.md` — 待解决问题清单（安全、集群、可靠性等）
- `doc/design/Agent-Bridge-完整技术方案.md` — 完整技术方案
- `CHANGELOG.md` — 进度记录
- `doc/archive/` — 已完成的需求文档归档

## 核心设计原则

- **AI-native**：智能在 LLM，基础设施只传消息
- **不修改任何框架源码**：通过外部接口对接（WebSocket / tmux）
- **不过度工程化**：用最少代码解决问题（~320 行）
- **弱模型也能用**：Agent 只需 curl 即可通信
