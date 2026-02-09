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

### 接下来要做

**Phase 1 收尾**
- TODO 10：本机通信验证（需要实际 OpenClaw Gateway 环境）

**Phase 2：跨机器通信**
- 第二台机器部署 Bridge
- 验证跨机器消息投递
- 编写 Claude Code 适配器（tmux 管理）
- 验证 CC 创建 + curl 回调通知

**Phase 3：自主运行**
- 实现 `/spawn` + `/stop` 端点
- 配置 Cron 心跳
- 编写 CEO 自主决策 Prompt
- 系统自主运行 24h 观察
