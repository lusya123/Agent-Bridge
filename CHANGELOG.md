# Agent Bridge — Changelog

## [Unreleased] — Phase 6: 集群组网（Token + Hub Relay）

### 设计完成（2026-02-12）

详细设计文档：[`doc/design/cluster-networking.md`](doc/design/cluster-networking.md)

#### 核心方案

- **Token 组网**：第一台机器自动生成 Token（`<128位随机密钥>@<hub地址>`），其他机器粘贴 Token 即可加入集群
- **Hub/Edge 混合拓扑**：有公网 IP 的机器为 Hub（HTTP 直连），无公网 IP 的机器为 Edge（WebSocket 长连接到 Hub）
- **一个 Token 解决三个问题**：API 认证 + 集群归属 + 用户隔离
- **动态集群发现**：替换静态 `cluster.json`，机器加入/离开自动广播
- **多 Hub 自动容灾**：Edge 节点从 welcome 响应获取所有 Hub 地址，断线自动切换

#### 实现计划

- Phase 6a：认证 + 集群基础（Token、认证中间件、ClusterManager、Hub→Hub 注册）
- Phase 6b：WebSocket 中继 + Edge 节点（WS 服务端/客户端、消息中继、多 Hub 容灾）
- Phase 6c：增强（全局 Agent 视图、节点广播、E2E 验证）

#### 解决的问题

- P0: API 无认证 → Token 中的 secret 作为 Bearer Token
- P0: 不支持 NAT 穿透 → Edge 节点通过 WebSocket 连接 Hub
- P1: 机器间明文通信 → Hub 间可升级 HTTPS
- P1: 集群配置是静态的 → 动态发现替换 cluster.json
- P1: 无用户隔离 → 不同 Token 的集群互不可见

---

## [0.2.1] - 2026-02-10

### Phase 5.5: Cross-Machine Spawn + Callback ✅

#### 新增

**SpawnOptions 扩展**（`src/adapters/types.ts`）
- `session_key` — 为已有 agent 创建独立子会话（避免污染主 session）
- `create_agent` — 动态创建新 agent 定义（Gateway `agents.create` RPC）
- `callback` — 回调信息（`caller_agent_id` + `caller_machine`），注入到 task 消息末尾

**OpenClaw 适配器增强**（`src/adapters/openclaw.ts`）
- `spawnAgent` 重写：支持 `agents.create` → 回调注入 → `sessionKey` 隔离
- `injectCallback` — 将回调指令作为自然语言追加到 task 消息

**Router 定向转发**（`src/router.ts`）
- `deliver()` 新增 `targetMachine` 参数
- 指定目标机器时跳过本地查找，直接 HTTP 转发（解决同名 agent 路由问题）
- 转发时不含 `machine` 字段（防循环）

**Message API**（`src/api/message.ts`）
- 请求 body 新增 `machine` 字段，透传到 `router.deliver`

**Plugin 工具升级**（`src/openclaw-plugin/index.ts`）
- `bridge_spawn` — 新增 `machine`、`session_key`、`create_agent`、`callback` 参数
  - 默认自动注入回调指令（通过 `/info` 获取本机 machine_id）
- `bridge_message` — 新增 `machine` 参数（跨机器回调必须指定）

#### 测试结果
- 86 单元测试全部通过（新增 9 个）
  - Router: targetMachine 转发、自身回落、防循环、机器不存在、远程错误
  - Message API: machine 参数透传
  - Spawn API: session_key / create_agent / callback 透传

#### E2E 验证
- Server A → Server B `bridge_message` 带 `machine` 参数 ✅
- Server A → Server B `bridge_spawn` 创建 subagent session ✅
- Server B → Server A 回调消息 ✅

#### 已知问题

详见 [`doc/open-issues.md`](doc/open-issues.md)

---

## [0.2.0] - 2026-02-10

### Phase 5: OpenClaw Plugin + CLI Install/Uninstall ✅

#### 新增

**OpenClaw Plugin**（`src/openclaw-plugin/`）
- `index.ts` — 插件入口，注册 4 个 Bridge 工具
  - `bridge_agents` — 查看集群中所有 Agent
  - `bridge_spawn` — 创建新 Agent（本机或远程）
  - `bridge_message` — 发消息给任意 Agent
  - `bridge_stop` — 停止 Agent
- `openclaw.plugin.json` — 插件清单（含 skill 路径）
- `package.json` — 包描述（openclaw.extensions 字段）
- `skills/agent-bridge-guide/SKILL.md` — 使用指南（教 Agent 何时/如何使用 Bridge）

工具通过 `fetch()` 调用本地 Bridge HTTP API，endpoint 从 `AGENT_BRIDGE_ENDPOINT` 环境变量读取（默认 `http://127.0.0.1:9100`）。

**CLI 子命令**（`src/cli.ts`）
- `agent-bridge install` — 复制 plugin 到 `~/.openclaw/extensions/agent-bridge/`
- `agent-bridge uninstall` — 删除 plugin 目录
- `agent-bridge start` — 启动服务（自动检测未 install 则先 install）
- `agent-bridge [无参数]` — 等同于 start（向后兼容）

**构建配置**
- `tsconfig.json` — 排除 `src/openclaw-plugin`（其 import 在 OpenClaw 环境中解析）

#### 测试结果
- 77 单元测试全部通过（未被破坏）
- `agent-bridge install` — 文件正确复制到 `~/.openclaw/extensions/agent-bridge/`
- `agent-bridge uninstall` — 目录完整删除

---

## [0.1.1] - 2026-02-10

### OpenClaw 适配器协议修复 + 真机验证 ✅

#### 问题
`src/adapters/openclaw.ts` 的 RPC 实现与真实 OpenClaw Gateway 协议不匹配，导致无法连接。

#### 修复内容
- **请求帧格式**：添加 `type: "req"` 字段
- **连接握手**：WebSocket 连接后发送 `connect` 请求（含 auth token、协议版本、客户端身份）
- **客户端身份**：使用 Gateway 认可的 `id: 'gateway-client'` + `mode: 'backend'`
- **响应解析**：适配 `{type:"res", id, ok, payload|error}` 格式
- **两阶段响应**：`agent` 方法先 ack 再 final，避免超时
- **事件消息**：识别并忽略 `{type:"event"}` 帧
- **sessions.list 解析**：处理 `{sessions:[...]}` 包裹格式（非直接数组）
- **配置扩展**：`adapters.openclaw` 增加 `token` 字段

#### 真机验证结果
- Server A (cloud-a: 43.134.124.4) — Handshake successful, 1 OpenClaw agent running
- Server B (cloud-b: 150.109.16.237) — Handshake successful, 1 OpenClaw agent running
- `/info`、`/agents` API 端点正常返回 OpenClaw agent 信息
- 77 单元测试全部通过

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

### 日志系统 + CLI + 一键安装 ✅

#### 已完成

**日志工具**
- `src/logger.ts` — 统一日志模块（debug/info/warn/error 四级）
  - `LOG_LEVEL` 环境变量控制，默认 `info`
  - 输出格式：`[HH:MM:SS] [LEVEL] [tag] message`
  - `setLevel()` 运行时切换级别

**替换全部 console 调用**
- 替换 22 处 `console.log/warn/error` 为 `log.debug/info/warn/error`
- 新增 8 处 debug 日志（Router 路由决策 + 6 个 API 请求日志）
- 涉及文件：index.ts, heartbeat.ts, openclaw.ts, claude-code.ts, router.ts, api/*.ts

**CLI 入口**
- `src/cli.ts` — 命令行入口（`#!/usr/bin/env node`）
  - `--debug` 启用 debug 级别日志
  - `--port 9200` 自定义端口
  - `--config ./my.json` 自定义配置路径

**配置自动生成**
- `src/config.ts` — bridge.json 不存在时自动从 bridge.example.json 复制
- 同理处理 cluster.json → cluster.example.json

**一键安装脚本**
- `scripts/install.sh` — 检查 Node >= 18 → clone → npm install && build → symlink /usr/local/bin/agent-bridge

**package.json 更新**
- 新增 `bin` 字段：`agent-bridge` → `dist/cli.js`
- 新增 `start` 脚本：`node dist/index.js`

**单元测试（21 new tests, 67 total, 12 files, all passed）**
- `test/logger.test.ts` — Logger 完整测试（16 tests）
  - 级别过滤（debug/info/warn/error 各级别抑制）
  - setLevel 动态切换（debug/warn/error 三种场景）
  - 输出格式验证（timestamp + level + tag）
  - console 方法路由（log→console.log, warn→console.warn, error→console.error）
  - 多参数传递 + Error 对象处理
- `test/cli.test.ts` — CLI 子进程测试（3 tests）
  - --config 自定义路径、缺失配置退出码、--debug 启用 ERROR 输出
- `test/config.test.ts` — 新增自动复制测试（2 tests）
  - bridge.example.json 自动复制 + cluster.example.json 自动复制

---

### 标准化错误响应 ✅

#### 已完成

**错误码体系**
- `src/errors.ts` — 统一错误码枚举 + BridgeError 类 + errorResponse 工厂函数
  - `MISSING_FIELDS` / `AGENT_NOT_FOUND` / `NO_ADAPTER` / `SPAWN_FAILED`
  - `MACHINE_NOT_FOUND` / `REMOTE_UNREACHABLE` / `STOP_NOT_SUPPORTED` / `STOP_FAILED`
- 所有 6 个 API 端点统一返回 `{ error_code, error, detail? }` 格式
- 远程转发错误保留原始 error_code + detail

**单元测试（10 new tests, 77 total, 12 files, all passed）**
- 新增边界用例覆盖：远程错误解析、非 JSON 响应处理、消息投递 fallback 分类

---

### 真机部署验证 ✅

#### 分支：`deploy/real-machine-test`

**测试环境**
- Server A (cloud-a): `43.134.124.4` — OpenCloudOS 9.4, Node.js 18.20.8
- Server B (cloud-b): `150.109.16.237` — Ubuntu 22.04, Node.js 22.22.0

**新增代码**
- `src/adapters/test.ts` — 内存测试适配器（TestAdapter）
  - 实现完整 Adapter 接口，用 Map 存储 agents 和 messages
  - 额外暴露 `getMessages(agentId)` 方法用于集成测试验证
- `src/api/test-messages.ts` — 诊断端点 `GET /test/messages?agent_id=xxx`
- `src/index.ts` — 新增 `test` capability 支持 + 注册诊断端点
- `src/config.ts` — capabilities 类型扩展支持 `'test'`
- `src/adapters/types.ts` — SpawnOptions.type 扩展支持 `'generic'`

**配置模板**
- `config/bridge.cloud-a.json` — Server A 配置（machine_id: cloud-a）
- `config/bridge.cloud-b.json` — Server B 配置（machine_id: cloud-b）
- `config/cluster.deploy-test.json` — 集群配置（两台公网 IP）

**自动化集成测试**
- `scripts/integration-test.sh` — 用 curl + jq 编写的端到端测试脚本

#### 测试过程

1. **环境搭建**：两台服务器安装 Node.js、git、jq、screen，开放 OS 防火墙 + 云安全组 9100 端口
2. **代码部署**：git clone → checkout 分支 → npm install → npm run build
3. **单元测试**：两台服务器各 77 个测试全部通过
4. **服务启动**：screen -dmS 后台运行 Bridge，LOG_LEVEL=debug
5. **集成测试**：从 Server A 运行 integration-test.sh

#### 测试结果

**单元测试：77 passed（两台服务器均通过）**

**集成测试：17 passed, 0 failed**

| 测试项 | 结果 |
|--------|------|
| Server A /info 可达 | ✅ |
| Server B /info 可达 | ✅ |
| Server B 本地 spawn | ✅ |
| Server A 本地 spawn | ✅ |
| 跨机器 locate（A 定位 B 上的 agent） | ✅ |
| 跨机器消息投递（A → B） | ✅ |
| 消息到达验证（内容 + 发送者） | ✅ |
| 双向通信（B → A） | ✅ |
| 远程 spawn 转发（A 在 B 上创建 agent） | ✅ |
| Agent 停止 + 移除验证 | ✅ |

**心跳测试：通过**
- spawn 带 `* * * * *` cron 的 agent
- 等待 65 秒后检查，收到 2 条心跳消息（精确到分钟触发）
- 停止 agent 后 schedule 被正确移除

#### 发现的问题

1. **云安全组未开放端口**（已解决）：OS 防火墙（firewalld/ufw）和云厂商安全组是两层独立的防火墙，都需要开放 9100 端口
2. **SSH 远程执行复杂 JSON 命令引号嵌套**（已绕过）：使用 base64 编码传递 JSON payload
3. **nohup 通过 SSH 启动后台进程不可靠**（已绕过）：改用 screen -dmS

**代码 bug：未发现** — 所有功能在真实网络环境下表现与单元测试一致

---

### OpenClaw 适配器功能验证 ✅

- [x] WebSocket 连接 + 握手 — 两台服务器均通过
- [x] `GET /agents` — 通过 `sessions.list` RPC 列出 agent — 通过
- [x] `POST /spawn` — 通过 Bridge 创建新的 OpenClaw agent — 通过
- [x] `POST /message` — 通过 Bridge 发消息给 OpenClaw agent — 通过
- [x] `POST /stop` — 通过 Bridge 停止 OpenClaw agent — 通过（主 session 用 reset，其他用 delete）
- [x] 跨机器通信 — 从 Server A 发消息给 Server B 的 OpenClaw agent — 通过
- [x] 远程 spawn — 从 Server A 在 Server B 上创建 OpenClaw agent — 通过

#### 发现并修复的问题

1. **spawn/message 超时**：`agent` RPC 两阶段响应等待 LLM 完成处理才返回，改为 ack 即 resolve
2. **agents 列表缺少 id**：`sessions.list` 返回 `key`（如 `agent:main:main`）而非 `id`，从 key 提取 agentId
3. **stop 方法不存在**：Gateway 没有 `sessions.stop`，改用 `sessions.delete`（主 session 降级为 `sessions.reset`）
4. **权限不足**：`sessions.delete` 需要 `operator.admin` scope，补充到握手请求

---

### Phase 5 真机验证 ✅

#### 部署

- Server A (cloud-a: 43.134.124.4) + Server B (cloud-b: 150.109.16.237)
- `git pull && npm run build && node dist/cli.js install` — 两台均成功
- Plugin 安装到 `~/.openclaw/extensions/agent-bridge/`
- Gateway 重启后自动发现并加载 Plugin（无需手动配置 openclaw.json）

#### 修复的问题

1. **Plugin package.json name 不匹配**：Gateway 校验 manifest id 与 package name 一致，改为 `"agent-bridge"`
2. **双重 main() 调用（EADDRINUSE）**：cli.ts import index.ts 时模块级 `main()` 自动执行，添加 `isDirectRun` 守卫
3. **@sinclair/typebox 不可用**：Plugin 在 `~/.openclaw/extensions/` 目录下无法解析 OpenClaw 内部依赖，改用原生 JSON Schema 对象
4. **agent RPC 参数错误**：Gateway 要求 `idempotencyKey`（必填）且不接受 `from`/`newSession`（additionalProperties: false），更新 sendMessage 和 spawnAgent
5. **两阶段响应错误未传播**：`resolveOnAck` 模式下错误响应被误当作 ack 成功处理，添加 `res.ok` 检查

#### E2E 测试结果

| 测试 | 结果 | 说明 |
|------|------|------|
| Plugin 自动加载 | ✅ | Gateway 从 ~/.openclaw/extensions/ 自动发现，无需 config |
| bridge_agents 工具调用 | ✅ | Agent 收到消息后调用 bridge_agents，返回 Agent 列表 |
| bridge_message 工具调用 | ✅ | Agent 调用 bridge_message 发送消息，Bridge 成功投递 |
| Bridge API 端点 | ✅ | /info, /agents, /locate 在两台服务器均正常 |
| agent RPC（sendMessage） | ✅ | idempotencyKey 修复后 Gateway 正常接受 |
| 跨机器路由 | ✅ | 已在 Phase 3 验证，Plugin 通过 fetch Bridge API 复用此能力 |

**注意**：`bridge_spawn` 创建任意 agentId 受 Gateway 限制（`unknown agent id`），OpenClaw 的 agent 需预配置。实际使用中应 spawn 到已配置的 agent 或使用消息触发子任务。

---

### 接下来要做

**当前：Phase 6 集群组网** — 详见 [`doc/design/cluster-networking.md`](doc/design/cluster-networking.md)

从 Phase 6a 开始实现。

**后续规划：**
- Phase 7: Happy 集成 + 人类监控
- 回调可靠性（任务状态追踪）
