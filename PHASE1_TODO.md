# Phase 1：基础搭建 — TODO 列表

> 目标：Bridge 核心服务 + OpenClaw 适配器 + 本机通信验证

---

## TODO 1：项目初始化

- [ ] 创建目录结构
  - `src/`, `src/api/`, `src/adapters/`
  - `config/`, `scripts/`, `test/`, `test/api/`, `test/adapters/`
- [ ] 初始化 `package.json`（name: agent-bridge, type: module）
- [ ] 配置 `tsconfig.json`（target: ES2022, module: NodeNext）
- [ ] 安装生产依赖：`hono`, `@hono/node-server`, `ws`
- [ ] 安装开发依赖：`typescript`, `tsx`, `vitest`, `@types/ws`
- [ ] 创建 `.gitignore`（node_modules, dist, .env, *.log）
- [ ] 创建 `.env.example`
  ```
  PORT=9100
  MACHINE_ID=my-machine
  CONFIG_PATH=./config/bridge.json
  ```
- [ ] 配置 npm scripts：`dev`, `build`, `test`

## TODO 2：配置系统

- [ ] 编写 `config/bridge.example.json`
  ```json
  {
    "machine_id": "cloud-a",
    "port": 9100,
    "capabilities": ["openclaw", "claude-code"],
    "max_agents": 5,
    "persistent_agents": [],
    "adapters": {
      "openclaw": { "gateway": "ws://127.0.0.1:18789" },
      "claude_code": { "tmux_session": "agents" }
    }
  }
  ```
- [ ] 编写 `config/cluster.example.json`
  ```json
  {
    "machines": [
      { "id": "cloud-a", "bridge": "http://100.64.0.2:9100", "role": "center" }
    ]
  }
  ```
- [ ] 实现 `src/config.ts`
  - 定义 BridgeConfig / ClusterConfig 类型
  - 加载 bridge.json + cluster.json
  - 支持环境变量覆盖（PORT, MACHINE_ID）

## TODO 3：适配器接口定义

- [ ] 定义 `src/adapters/types.ts`
  - `AgentInfo` 类型：id, type, status, persistent, task
  - `SpawnOptions` 类型：type, agent_id, task, persistent, heartbeat
  - `Adapter` 接口：
    - `sendMessage(agentId: string, from: string, message: string): Promise<void>`
    - `listAgents(): Promise<AgentInfo[]>`
    - `spawnAgent?(options: SpawnOptions): Promise<string>`
    - `stopAgent?(agentId: string): Promise<void>`

## TODO 4：OpenClaw 适配器

- [ ] 实现 `src/adapters/openclaw.ts`
  - 构造函数：接收 Gateway WebSocket 地址（默认 `ws://127.0.0.1:18789`）
  - 连接管理：自动连接、断线重连（指数退避）
  - `sendMessage` → 通过 WebSocket 调用 Gateway `agent` RPC 方法
  - `listAgents` → 通过 WebSocket 调用 Gateway `sessions.list` RPC 方法
  - 错误处理：连接失败、RPC 超时
- [ ] 编写测试 `test/adapters/openclaw.test.ts`
  - Mock WebSocket 连接
  - 测试消息发送、Agent 列表查询
  - 测试断线重连逻辑

## TODO 5：核心 API — `GET /info`

- [ ] 实现 `src/api/info.ts`
  - 从配置读取 machine_id, capabilities, max_agents
  - 动态获取 resources（cpu_cores, memory_gb）
  - 查询 running_agents 数量
  - 返回 persistent_agents 列表
- [ ] 编写测试 `test/api/info.test.ts`

## TODO 6：核心 API — `GET /agents`

- [ ] 实现 `src/api/agents.ts`
  - 遍历所有已注册适配器，调用 `listAgents()`
  - 合并结果，返回统一格式的 Agent 列表
  - 每个 Agent 包含：id, type, status, persistent, task
- [ ] 编写测试 `test/api/agents.test.ts`

## TODO 7：核心 API — `GET /locate`

- [ ] 实现 `src/api/locate.ts`
  - 接收 query 参数 `agent_id`
  - 先查本机所有适配器
  - 未找到 → 并行请求 cluster.json 中其他机器的 `GET /agents`
  - 返回：agent_id, machine, bridge URL, type
  - 全部未找到 → 404
- [ ] 编写测试 `test/api/locate.test.ts`

## TODO 8：核心 API — `POST /message`

- [ ] 实现 `src/api/message.ts`
  - 接收 JSON body：{ agent_id, from, message }
  - 参数校验
  - 调用 router 进行投递
- [ ] 实现 `src/router.ts`
  - 查本机适配器是否有目标 Agent
  - 有 → 通过适配器 `sendMessage` 本地投递
  - 无 → 调用 `/locate` 找到目标机器 → HTTP POST 转发到目标 Bridge
  - 转发失败 → 返回错误
- [ ] 编写测试 `test/api/message.test.ts`

## TODO 9：服务入口

- [ ] 实现 `src/index.ts`
  - 加载配置（`src/config.ts`）
  - 根据 capabilities 初始化对应适配器
  - 注册 6 个 API 路由到 Hono app
  - 启动 HTTP 服务（默认 :9100）
  - 打印启动日志（machine_id, port, capabilities）

## TODO 10：本机通信验证

- [ ] 在 CEO 所在机器部署 Bridge
  - 复制 bridge.example.json → bridge.json，填入实际配置
  - `npm run dev` 启动服务
- [ ] 验证 `GET /info` — 返回正确的机器信息
- [ ] 验证 `GET /agents` — 返回 OpenClaw Gateway 中的 Agent 列表
- [ ] 验证 `POST /message` — 消息成功投递给本机 OpenClaw Agent
- [ ] 验证 CEO Agent 能通过 curl 调用 Bridge API
  - CEO 执行 `curl http://127.0.0.1:9100/agents` 查看 Agent 列表
  - CEO 执行 `curl -X POST http://127.0.0.1:9100/message` 发消息

---

## Phase 1 完成标准

1. Bridge 服务能在 :9100 正常启动
2. `/info`, `/agents`, `/locate`, `/message` 四个端点正常工作
3. OpenClaw 适配器能连接 Gateway 并收发消息
4. CEO 能通过 `curl http://127.0.0.1:9100/message` 给本机 Agent 发消息
5. 核心功能有单元测试覆盖

## 依赖关系

```
TODO 1（项目初始化）
  └── TODO 2（配置系统）
       └── TODO 3（适配器接口）
            ├── TODO 4（OpenClaw 适配器）
            ├── TODO 5（/info）
            ├── TODO 6（/agents）← 依赖 TODO 4
            ├── TODO 7（/locate）← 依赖 TODO 6
            └── TODO 8（/message）← 依赖 TODO 7
                 └── TODO 9（服务入口）← 依赖 TODO 5-8
                      └── TODO 10（验证）
```
