# Agent Bridge

分布式 Agent 通信平台 — 让不同框架的 Agent 跨机器协作。

## 为什么需要 Agent Bridge？

当你有多台机器、多个 Agent 框架（OpenClaw、Claude Code 等），它们之间需要互相通信时，Agent Bridge 就是那个"邮局"：

- **跨机器**：Agent A 在 cloud-a，Agent B 在 cloud-b，Bridge 帮它们传话
- **跨框架**：OpenClaw Agent 和 Claude Code Agent 通过统一 API 对话
- **弱模型友好**：Agent 只需要会 `curl` 就能参与协作

## 架构

```
┌─────────────────────────────────────────────────────┐
│                    Machine A (cloud-a)               │
│                                                      │
│  ┌──────────┐    ┌───────────────────────────────┐  │
│  │ OpenClaw │◄──►│         Agent Bridge           │  │
│  │ Gateway  │ ws │  :9100                         │  │
│  │  :18789  │    │  ┌─────┐ ┌──────┐ ┌────────┐  │  │
│  └──────────┘    │  │ API │→│Router│→│Adapters│  │  │
│                  │  └─────┘ └──────┘ └────────┘  │  │
│  ┌──────────┐    │                                │  │
│  │  tmux    │◄──►│  Heartbeat Manager             │  │
│  │ sessions │    └──────────────┬────────────────┘  │
│  └──────────┘                  │ HTTP forward       │
└────────────────────────────────┼─────────────────────┘
                                 │ Tailscale VPN
┌────────────────────────────────┼─────────────────────┐
│                Machine B (cloud-b)                    │
│                                │                      │
│                  ┌─────────────▼─────────────────┐   │
│                  │        Agent Bridge            │   │
│                  │        :9100                   │   │
│                  └───────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**三层架构：**

| 层 | 职责 | 实现 |
|---|------|------|
| HTTP API | 6 个端点，统一入口 | Hono |
| 路由层 | 本机直投 / 远程 HTTP 转发 | Router |
| 适配器层 | 对接具体框架 | OpenClaw (WebSocket) / Claude Code (tmux) |

## 文档

| 文档 | 说明 |
|------|------|
| [配置参考](doc/configuration.md) | bridge.json / cluster.json 字段详解、环境变量、CLI 参数 |
| [部署指南](doc/deployment.md) | 单机/多机部署、Tailscale 组网、进程管理、防火墙配置 |
| [API 参考](doc/api-reference.md) | 6 个端点完整格式、错误码一览、跨机器路由行为 |
| [故障排查](doc/troubleshooting.md) | 常见问题及解决方案、调试技巧 |

> 内部设计文档在 [doc/design/](doc/design/) 目录下。

## 快速开始

### 安装

```bash
# 要求 Node.js >= 18
git clone https://github.com/user/agent-bridge.git
cd agent-bridge
npm install
npm run build
```

或一键安装：

```bash
curl -sSL https://your-repo/scripts/install.sh | bash
```

### 配置

首次启动会自动从 `config/*.example.json` 复制配置文件，编辑即可：

```bash
# 本机配置
vim config/bridge.json

# 集群配置（多机器时需要）
vim config/cluster.json
```

**bridge.json** — 本机设置：

```json
{
  "machine_id": "cloud-a",
  "port": 9100,
  "capabilities": ["openclaw", "claude-code"],
  "max_agents": 5,
  "persistent_agents": [
    {
      "id": "ceo",
      "type": "openclaw",
      "auto_start": true,
      "workspace": "/home/agent/workspace-ceo"
    }
  ],
  "adapters": {
    "openclaw": { "gateway": "ws://127.0.0.1:18789" },
    "claude_code": { "tmux_session": "agents" }
  }
}
```

**cluster.json** — 集群拓扑：

```json
{
  "machines": [
    { "id": "cloud-a", "bridge": "http://100.64.0.2:9100", "role": "CEO + 调度中心" },
    { "id": "cloud-b", "bridge": "http://100.64.0.3:9100", "role": "采集 + 分析" },
    { "id": "local-mac", "bridge": "http://100.64.0.1:9100", "role": "本地开发 + 创作" }
  ]
}
```

### 启动

```bash
agent-bridge              # 默认启动
agent-bridge --debug      # 开启 debug 日志
agent-bridge --port 9200  # 自定义端口
agent-bridge --config ./my-bridge.json  # 自定义配置路径
```

## API

所有端点监听在 `http://<machine>:9100`。

### GET /info

返回本机信息。

```bash
curl http://localhost:9100/info
```

```json
{
  "machine_id": "cloud-a",
  "capabilities": ["openclaw", "claude-code"],
  "resources": {
    "cpu_cores": 4,
    "memory_gb": 16,
    "running_agents": 2,
    "max_agents": 5
  },
  "persistent_agents": [
    { "id": "ceo", "type": "openclaw", "status": "idle", "description": "CEO Agent" }
  ]
}
```

### GET /agents

列出本机所有运行中的 Agent。

```bash
curl http://localhost:9100/agents
```

```json
[
  { "id": "ceo", "type": "openclaw", "status": "running", "persistent": true },
  { "id": "tmp-cc-123", "type": "claude-code", "status": "running", "persistent": false }
]
```

### GET /locate?agent_id=xxx

在集群中定位 Agent 所在机器。

```bash
curl http://localhost:9100/locate?agent_id=ceo
```

```json
{
  "agent_id": "ceo",
  "machine": "cloud-a",
  "bridge": "http://100.64.0.2:9100",
  "type": "openclaw"
}
```

### POST /message

发消息给 Agent。如果目标在远程机器，自动转发。

```bash
curl -X POST http://localhost:9100/message \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "ceo", "from": "user", "message": "检查今天的任务"}'
```

```json
{ "ok": true }
```

### POST /spawn

创建新 Agent，支持持久化和心跳调度。

```bash
curl -X POST http://localhost:9100/spawn \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "claude-code",
    "agent_id": "analyzer",
    "task": "分析 /data/report.json 中的数据",
    "persistent": false,
    "heartbeat": {
      "hourly": "[心跳] 检查进度",
      "daily_9am": "[日报] 生成报告"
    }
  }'
```

```json
{ "ok": true, "agent_id": "analyzer", "machine": "cloud-a" }
```

心跳调度选项：

| 名称 | Cron 表达式 | 说明 |
|------|------------|------|
| `hourly` | `0 * * * *` | 每小时 |
| `daily_9am` | `0 9 * * *` | 每天早上 9 点 |
| `weekly_monday` | `0 9 * * 1` | 每周一早上 9 点 |
| 自定义 | 任意 cron | 传入合法 cron 表达式作为 key |

### POST /stop

停止 Agent 并清理心跳。

```bash
curl -X POST http://localhost:9100/stop \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "analyzer"}'
```

```json
{ "ok": true }
```

## 适配器

Bridge 通过适配器对接不同的 Agent 框架，所有适配器实现统一接口：

```typescript
interface Adapter {
  type: string;
  connect(): Promise<void>;
  sendMessage(agentId: string, message: string): Promise<void>;
  spawnAgent(agentId: string, task: string): Promise<void>;
  stopAgent(agentId: string): Promise<void>;
  listAgents(): Promise<AgentInfo[]>;
}
```

### OpenClaw 适配器

通过 WebSocket 连接 OpenClaw Gateway，使用 JSON-RPC 协议通信。

- 连接地址：`ws://127.0.0.1:18789`（可配置）
- 自动重连 + 指数退避
- RPC 超时：10 秒

### Claude Code 适配器

通过 tmux 管理 Claude Code 进程实例。

- 创建 Agent：`tmux new-window -n <agent_id> "claude --print '<task>'"`
- 发消息：`tmux send-keys -t <session>:<agent_id> '<message>' Enter`
- 停止：`tmux kill-window -t <session>:<agent_id>`
- 列表：解析 `tmux list-windows` 输出

## 消息路由

```
收到 /message 请求
    │
    ▼
本机适配器有这个 Agent？ ──是──► 直接投递
    │
    否
    ▼
遍历集群机器，HTTP 转发 ──成功──► 返回 ok
    │
    全部失败
    ▼
返回 404: Agent not found
```

## 心跳系统

心跳 = 定时给 Agent 发消息，让 LLM 自主决策下一步行动。

**工作方式：**
1. `/spawn` 时传入 `heartbeat` 参数注册调度
2. HeartbeatManager 使用 node-cron 在进程内调度
3. 到时间后自动调用 `/message` 给目标 Agent 发消息
4. 调度信息持久化到 `data/heartbeats.json`，重启自动恢复

**生产环境**也可用系统 cron：

```bash
sudo bash scripts/setup-heartbeat.sh
```

## 网络

推荐使用 [Tailscale](https://tailscale.com/) 组网：

- 所有机器加入同一 Tailscale 网络
- 使用 100.64.x.x 固定 IP 直连
- 无需 NAT 穿透、端口映射

## 开发

```bash
npm run dev        # 开发模式（tsx watch，热重载）
npm test           # 运行测试
npm run test:watch # 测试监听模式
npm run build      # TypeScript 编译
```

## 项目结构

```
src/
├── index.ts          # 服务入口，初始化适配器 + 路由 + 心跳
├── cli.ts            # CLI 入口，解析命令行参数
├── config.ts         # 配置加载（bridge + cluster）
├── router.ts         # 消息路由（本机直投 / 远程转发）
├── heartbeat.ts      # 心跳管理器（node-cron 调度 + 持久化）
├── logger.ts         # 日志系统（4 级别，无外部依赖）
├── adapters/
│   ├── types.ts      # 适配器统一接口
│   ├── openclaw.ts   # OpenClaw 适配器（WebSocket RPC）
│   └── claude-code.ts # Claude Code 适配器（tmux）
└── api/
    ├── info.ts       # GET  /info
    ├── agents.ts     # GET  /agents
    ├── locate.ts     # GET  /locate
    ├── message.ts    # POST /message
    ├── spawn.ts      # POST /spawn
    └── stop.ts       # POST /stop

config/
├── bridge.example.json   # 本机配置模板
├── cluster.example.json  # 集群配置模板
└── ceo-prompt.md         # CEO Agent 自主决策 Prompt

scripts/
├── install.sh            # 一键安装脚本
└── setup-heartbeat.sh    # 生产环境 cron 安装
```

## 技术栈

| 组件 | 技术 | 选型理由 |
|------|------|---------|
| 语言 | TypeScript | 类型安全 |
| HTTP | Hono | 轻量，零依赖 |
| WebSocket | ws | 连接 OpenClaw Gateway |
| 进程管理 | tmux | 管理 Claude Code 实例 |
| 定时调度 | node-cron | 进程内心跳调度 |
| 测试 | vitest | 快速，原生 TS 支持 |

## 设计原则

- **AI-native** — 智能在 LLM 里，基础设施只负责传消息
- **不改框架源码** — 通过外部接口对接（WebSocket / tmux）
- **不过度工程化** — 用最少代码解决问题
- **弱模型也能用** — Agent 只需 `curl` 即可通信

## License

MIT
