# Agent Bridge — Changelog

## [0.1.0] - 2026-02-09

### Phase 1：基础搭建 ✅

#### 已完成

**项目初始化**
- 创建完整目录结构（src/api, src/adapters, config, scripts, test）
- 初始化 package.json（type: module）+ tsconfig.json
- 安装依赖：hono, @hono/node-server, ws, typescript, tsx, vitest
- 创建 .gitignore, .env.example

**规划文档**
- `PROJECT_STRUCTURE.md` — 项目目录结构
- `CLAUDE.md` — Claude Code 项目上下文
- `PHASE1_TODO.md` — Phase 1 详细 TODO（10 项）

**配置系统**
- `config/bridge.example.json` — 本机配置模板
- `config/cluster.example.json` — 集群机器列表模板
- `src/config.ts` — 配置加载 + 类型定义 + 环境变量覆盖

**适配器层**
- `src/adapters/types.ts` — 统一适配器接口（Adapter, AgentInfo, SpawnOptions）
- `src/adapters/openclaw.ts` — OpenClaw 适配器（WebSocket RPC, 自动重连）

**API 层（6 个端点）**
- `GET /info` — 机器信息（CPU、内存、运行中 Agent 数）
- `GET /agents` — 聚合所有适配器的 Agent 列表
- `GET /locate` — 先查本机，再并行查集群定位 Agent
- `POST /message` — 本机直投 / 远程 HTTP 转发
- `POST /spawn` — 占位（Phase 3）
- `POST /stop` — 占位（Phase 3）

**路由层**
- `src/router.ts` — 消息路由（本机适配器直投 / 远程 Bridge 转发）

**服务入口**
- `src/index.ts` — 加载配置 → 初始化适配器 → 注册路由 → 启动 :9100

**状态：TypeScript 编译零错误**

**单元测试（20 tests, 6 files, all passed）**
- `test/helpers.ts` — 共享 mock adapter 工厂函数
- `test/config.test.ts` — 配置加载、env 覆盖、缺失文件处理（5 tests）
- `test/router.test.ts` — 本机投递、多适配器查找、agent 未找到（4 tests）
- `test/api/info.test.ts` — 机器信息、Agent 数量聚合（2 tests）
- `test/api/agents.test.ts` — 多适配器聚合、空列表（2 tests）
- `test/api/locate.test.ts` — 本机定位、缺参数 400、未找到 404（3 tests）
- `test/api/message.test.ts` — 本机投递、缺参数 400、未找到 404（4 tests）

---

### Phase 2：跨机器通信 + Claude Code 适配器 ✅

#### 已完成

**Claude Code 适配器**
- `src/adapters/claude-code.ts` — 通过 tmux 管理 CC 实例
  - `connect` — 确保 tmux session 存在
  - `spawnAgent` — `tmux new-window` 创建 CC 实例
  - `sendMessage` — `tmux send-keys` 发送消息
  - `stopAgent` — `tmux kill-window` 停止实例
  - `listAgents` — `tmux list-windows` 解析窗口列表
  - `hasAgent` — 检查窗口是否存在

**API 端点升级**
- `POST /spawn` — 从占位改为实际实现，支持本机创建 + 远程转发
- `POST /stop` — 从占位改为实际实现，通过适配器停止 Agent

**服务入口更新**
- `src/index.ts` — 新增 Claude Code 适配器初始化，更新 spawn/stop 路由签名

**单元测试（14 new tests, 34 total, all passed）**
- `test/helpers.ts` — 更新 mock adapter，新增 spawnAgent/stopAgent 桩函数
- `test/adapters/claude-code.test.ts` — CC 适配器 tmux 命令 mock 测试（7 tests）
- `test/api/spawn.test.ts` — 本机创建、缺参数 400、无匹配适配器（4 tests）
- `test/api/stop.test.ts` — 停止 Agent、缺参数 400、未找到 404（3 tests）

---

### Phase 3：Cron 心跳 + CEO 自主决策 ✅

#### 已完成

**心跳管理器**
- `src/heartbeat.ts` — HeartbeatManager 类，进程内 cron 调度
  - `add` — 注册心跳（支持 hourly / daily_9am / weekly_monday + 自定义 cron 表达式）
  - `remove` — 移除 Agent 的所有心跳
  - `list` — 列出活跃心跳
  - `stopAll` — 清理所有心跳
  - `load` / `save` — 持久化到 `data/heartbeats.json`，重启自动恢复
  - 每个心跳 job 通过 HTTP POST 发送到 Bridge `/message` 端点

**API 集成**
- `POST /spawn` — 支持 `heartbeat` 参数，spawn 成功后自动注册心跳
- `POST /stop` — 停止 Agent 时自动清理心跳

**服务入口更新**
- `src/index.ts` — 初始化 HeartbeatManager，启动时恢复持久化心跳，传递给 spawn/stop handler

**CEO 自主决策 Prompt**
- `config/ceo-prompt.md` — CEO Agent 系统提示词
  - 职责定义、通信方式（sessions_send + curl Bridge）
  - 三种心跳行为（小心跳/日心跳/周心跳）
  - 决策原则（发布需人类审核、花钱需确认、分析可自主）

**生产部署脚本**
- `scripts/setup-heartbeat.sh` — 安装系统 cron 心跳到 `/etc/cron.d/agent-heartbeat`
  - 支持 `--port` 和 `--agent` 参数
  - 三种频率：每小时 + 每天 9 点 + 每周一 9 点

**新增依赖**
- `node-cron` — 轻量级进程内 cron 调度

**单元测试（12 new tests, 46 total, 10 files, all passed）**
- `test/heartbeat.test.ts` — HeartbeatManager 完整测试（9 tests）
  - add/remove/list/stopAll 基本操作
  - cron 表达式映射（hourly/daily/weekly + 自定义）
  - 无效表达式跳过
  - 持久化 save/load + 缺失文件处理
- `test/api/spawn.test.ts` — 新增心跳注册 + 无心跳不注册（2 tests）
- `test/api/stop.test.ts` — 新增停止时清理心跳（1 test）

---

### 接下来要做

**部署验证**
- 部署到云服务器验证跨机器通信
- 验证 OpenClaw 适配器连接 Gateway
- 验证 CC 适配器 tmux 管理
- 验证心跳调度实际触发

**Phase 4：Happy 集成 + 人类监控（可选）**
- 部署 Happy Daemon
- Bridge CC 适配器改为通过 Happy 管理
- 手机安装 Happy App
- 配置审批推送
