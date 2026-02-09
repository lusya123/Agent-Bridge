---
日期: 2026-02-09
类型: 技术方案文档（最终版）
状态: 设计阶段
版本: v2.0
关联对话:
  - Session ID: ea63f5ba (Agent军团战略构想)
  - Session ID: b3bf175b (Agent通信架构方案讨论)
关联文档:
  - 创意与需求/Agent军团战略构想-完整对话记录.md
  - 创意与需求/Agent通信架构方案讨论-完整对话记录.md
---

# Agent Bridge — 分布式 Agent 通信平台 完整技术方案

## 一、项目定位

### 1.1 Agent Bridge 是什么

Agent Bridge 是一个**独立的、通用的分布式 Agent 通信平台**。它不属于任何 Agent 框架，而是作为一个独立项目，让不同框架的 Agent 能够跨机器协作。

**它不是 OpenClaw 的插件，不是 Claude Code 的扩展，而是一个独立的基础设施层。**

### 1.2 解决什么问题

当前的 Agent 框架（OpenClaw、Claude Code 等）都是**单机系统**：
- OpenClaw 的 `sessions_send` 只能在同一个 Gateway 内通信
- Claude Code 没有 Agent 间通信能力
- 没有任何框架支持跨机器、跨框架的 Agent 协作

Agent Bridge 填补这个空白。

### 1.3 核心原则

| 原则            | 含义                                 |
| ------------- | ---------------------------------- |
| **AI-native** | 智能在 LLM 里，基础设施只负责"传消息"和"戳一下"       |
| **不过度工程化**    | 用最少的代码解决问题，避免提前假设                  |
| **模型越强系统越强**  | 基础设施不变，模型升级自动带来能力提升                |
| **弱模型也能用**    | AI 只需调用简单的 curl，复杂度在人写的代码里         |
| **不修改任何框架源码** | 通过外部接口对接，保持与上游兼容                   |
| **适配多框架**     | 不绑定 OpenClaw，也支持 Claude Code 及未来框架 |
|               |                                    |

### 1.4 系统全景

```
                    你（手机/电脑）
                      │
              Telegram / Happy App（人类入口）
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│              云服务器 A（CEO 所在机器）             │
│                                                 │
│  ┌─────────────┐     ┌───────────────────┐      │
│  │ OpenClaw CEO │◄───►│   Agent Bridge    │      │
│  │ (24h运行)    │     │   (:9100)         │      │
│  │ 大脑+决策    │     │   ┌─────────────┐ │      │
│  └─────────────┘     │   │ OC 适配器    │ │      │
│                      │   │ CC 适配器    │ │      │
│                      │   │ 通用适配器   │ │      │
│                      │   └─────────────┘ │      │
│                      └────────┬──────────┘      │
└───────────────────────────────┼──────────────────┘
                                │ Tailscale 网络
                   ┌────────────┼────────────┐
                   │            │            │
                   ▼            ▼            ▼
            ┌──────────┐ ┌──────────┐ ┌──────────────┐
            │ 云服务器B  │ │ 云服务器C  │ │ 你的本地 Mac  │
            │ Bridge    │ │ Bridge    │ │ Bridge       │
            │ +OpenClaw │ │ +CC实例   │ │ +Happy+CC    │
            │ (采集员)  │ │ (临时)    │ │ (你自己用的)  │
            └──────────┘ └──────────┘ └──────────────┘
```

---

## 二、四大组件与职责

| 组件               | 角色                   | 类比     | 是否必须        |
| ---------------- | -------------------- | ------ | ----------- |
| **OpenClaw CEO** | 大脑 — 24h运行、主动决策、调度一切 | 公司 CEO | 必须          |
| **Agent Bridge** | 神经系统 — 跨机器通信、统一接口    | 公司内网   | 必须          |
| **Claude Code**  | 手脚 — 按需创建、执行任务、用完即弃  | 临时工    | 必须          |
| **Happy Coder**  | 监控窗口 — 手机查看、审批推送     | 监控大屏   | 可选（Phase 4） |
|                  |                      |        |             |

### 角色分工原则

- **OpenClaw**：适合 24h 运行的"大脑"角色（有记忆压缩，上下文不会爆）
- **Claude Code**：适合一次性"执行"角色（每个任务全新 session，用完即弃）
- **Bridge**：只负责通信，不做任何业务决策
- **Happy**：只负责人类监控，不参与 Agent 间通信

### CEO Agent 的本质

**CEO 是 OpenClaw 配置文件里定义的一个 Agent**，不是 Bridge 的组件。它和 OpenClaw 里的其他 Agent（采集员、分析员等）是同级的，只是职责不同——它负责调度其他所有 Agent。

Bridge 的安装脚本（`install.sh --role=center`）会**自动写入 OpenClaw 配置**，定义 CEO Agent：

```json
{
  "agents": {
    "list": [
      {
        "id": "ceo",
        "name": "CEO Agent",
        "workspace": "/home/agent/workspace-ceo",
        "instructions": "你是一个自主运营的内容业务 CEO Agent...",
        "subagents": { "allowAgents": ["*"] }
      }
    ]
  }
}
```

**不是运行时动态创建，而是安装时写入配置。** OpenClaw Gateway 启动后，CEO Agent 自动存在。

### 三者关系

```
Bridge 安装脚本（一次性）
  ├── 配置 OpenClaw → 定义 CEO Agent（写入 OpenClaw 配置文件）
  ├── 配置系统 cron → 定时发心跳（写入 /etc/cron.d/）
  └── 启动 Bridge 服务 → 监听 :9100

运行时（持续）：
  系统 cron → curl → Bridge /message → OC 适配器 → OpenClaw Gateway → CEO Agent
                                                                        │
                                                              CEO 自主思考、决策
                                                                        │
                                                              curl → Bridge → 远程 Agent
```

**Bridge 是"安装者 + 通信层"，OpenClaw 是"Agent 运行时"，CEO 是 OpenClaw 里的一个 Agent。**

---

## 三、Agent Bridge 架构

### 3.1 分层设计

```
┌─────────────────────────────────────────┐
│           HTTP API 层（统一接口）          │
│  /message  /spawn  /agents  /info       │
│  /locate   /stop                        │
├─────────────────────────────────────────┤
│           路由层（跨机器转发）             │
│  本机 Agent → 直接投递                   │
│  远程 Agent → HTTP 转发到目标机器 Bridge  │
├─────────────────────────────────────────┤
│           适配器层（对接不同框架）          │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ OpenClaw │ │ Claude   │ │ 通用    │ │
│  │ Adapter  │ │ Code     │ │ Adapter │ │
│  │          │ │ Adapter  │ │         │ │
│  └──────────┘ └──────────┘ └─────────┘ │
└─────────────────────────────────────────┘
```

### 3.2 适配器详解

#### OpenClaw 适配器

**对接方式**：作为 WebSocket 客户端连接 OpenClaw Gateway（`ws://127.0.0.1:18789`）

**能力**：
- 发消息给 OpenClaw Agent → 调用 Gateway 的 `agent` RPC 方法
- 创建 Agent session → 调用 Gateway 的 `agent` RPC 方法（新 sessionKey）
- 查询 Agent 列表 → 调用 Gateway 的 `sessions.list` RPC 方法

**不修改 OpenClaw 任何代码。** Bridge 就是 Gateway 的一个普通客户端，和 OpenClaw CLI、macOS App 用同样的接口。

#### Claude Code 适配器

**对接方式**：通过 tmux 管理 Claude Code 实例，可选通过 Happy Daemon

**能力**：
- 创建 CC 实例 → `tmux new-window` 或 Happy Daemon `/spawn-session`
- 发消息给 CC → `tmux send-keys` 或 Happy Daemon 消息投递
- 停止 CC → kill tmux 窗口 或 Happy Daemon `/stop-session`
- 查询 CC 状态 → `tmux list-windows` 解析

#### 通用适配器（未来扩展）

**对接方式**：stdin/stdout 或 HTTP API

**适用于**：未来的 Agent 框架（Cursor Agent、Windsurf Agent 等）

### 3.3 API 设计（6 个端点）

#### `GET /info` — 机器自我介绍

```json
// 响应
{
  "machine_id": "cloud-b",
  "capabilities": ["openclaw", "claude-code"],
  "resources": { "cpu_cores": 4, "memory_gb": 16, "running_agents": 2, "max_agents": 5 },
  "persistent_agents": [
    { "id": "采集员", "type": "openclaw", "status": "idle", "description": "定时采集小红书数据" }
  ]
}
```

#### `GET /agents` — 当前运行的 Agent 列表

```json
// 响应
[
  { "id": "采集员", "type": "openclaw", "status": "running", "persistent": true, "task": "采集小红书热点" },
  { "id": "tmp-分析-a3f2", "type": "claude-code", "status": "running", "persistent": false, "task": "分析竞品数据" }
]
```

#### `GET /locate?agent_id=采集员` — 定位 Agent 在哪台机器

```json
// 响应
{ "agent_id": "采集员", "machine": "cloud-b", "bridge": "http://100.64.0.3:9100", "type": "openclaw" }
```

内部逻辑：先查本机，再并行查集群其他机器。

#### `POST /message` — 发消息给 Agent

```json
// 请求
{ "agent_id": "采集员", "from": "CEO", "message": "采集今天的小红书AI话题热点" }
```

内部逻辑：
1. 目标在本机？→ 通过适配器本地投递
2. 目标不在本机？→ 查 `/locate` → HTTP 转发到目标机器的 Bridge

#### `POST /spawn` — 创建新 Agent

```json
// 请求
{
  "type": "claude-code | openclaw",
  "machine": "cloud-b | auto",
  "task": "任务描述",
  "agent_id": "采集员",
  "persistent": false,
  "heartbeat": {
    "hourly": "[小心跳] 检查是否有需要处理的事项",
    "daily_9am": "[日心跳] 规划今天的工作"
  }
}
```

参数说明：
- `persistent: true` → Agent 24h 运行，不会在任务完成后销毁
- `heartbeat` → 自动配置 cron 定时任务，定期给 Agent 发心跳消息
- `machine: "auto"` → Bridge 自动选择负载最低的机器

#### `POST /stop` — 停止 Agent

```json
// 请求
{ "agent_id": "tmp-分析-a3f2" }
```

### 3.4 配置文件

**本机配置**（每台机器）：
```json
{
  "machine_id": "cloud-b",
  "port": 9100,
  "capabilities": ["openclaw", "claude-code"],
  "max_agents": 5,
  "persistent_agents": [
    { "id": "采集员", "type": "openclaw", "auto_start": true, "workspace": "/home/agent/workspace-采集员" }
  ],
  "adapters": {
    "openclaw": { "gateway": "ws://127.0.0.1:18789" },
    "claude_code": { "happy_daemon": "http://127.0.0.1:54321", "tmux_session": "agents" }
  }
}
```

**集群机器列表**（全局共享，Git 同步）：
```json
{
  "machines": [
    { "id": "cloud-a", "bridge": "http://100.64.0.2:9100", "role": "CEO + 调度中心" },
    { "id": "cloud-b", "bridge": "http://100.64.0.3:9100", "role": "采集 + 分析" },
    { "id": "local-mac", "bridge": "http://100.64.0.1:9100", "role": "本地开发 + 创作" }
  ]
}
```

### 3.5 代码规模

| 模块 | 预估行数 |
|------|---------|
| Bridge HTTP 服务（6个端点 + 路由） | ~150 行 |
| OpenClaw 适配器 | ~80 行 |
| Claude Code 适配器 | ~60 行 |
| 通用适配器（预留） | ~30 行 |
| **总计** | **~320 行** |

---

## 四、OpenClaw 与 Bridge 的协作方式

### 4.1 不修改 OpenClaw，不用 Skill 覆盖 Tool

OpenClaw 已有 `sessions_send`（本地通信）和 `sessions_spawn`（本地创建）。Bridge 不替代它们，而是**补充跨机器能力**。

### 4.2 CEO Agent 的通信方式

CEO 的 system prompt 中明确两种通信方式：

```
## 通信方式

### 本机 Agent（同一台机器上的 OpenClaw Agent）
直接使用 sessions_send 工具（OpenClaw 原生，支持 ping-pong 对话）

### 远程 Agent 或 Claude Code（其他机器上的）
执行 curl 命令调用 Bridge API：

查询 Agent 位置：
curl -s http://127.0.0.1:9100/locate?agent_id=目标Agent名

发消息：
curl -s -X POST http://127.0.0.1:9100/message -H 'Content-Type: application/json' \
  -d '{"agent_id":"目标","from":"CEO","message":"内容"}'

创建 Agent：
curl -s -X POST http://127.0.0.1:9100/spawn -H 'Content-Type: application/json' \
  -d '{"type":"claude-code","task":"任务描述","machine":"auto"}'

查看集群状态：
curl -s http://127.0.0.1:9100/info && 对每台机器执行 curl /agents
```

### 4.3 为什么不冲突

- `sessions_send` = OpenClaw 原生 Tool，用于**同 Gateway 内**通信
- `curl Bridge` = 通过 Bash 执行，用于**跨机器**通信
- 两者作用域不同，不会混淆
- CEO 先用 `/locate` 判断目标在哪，再选择对应方式

---

## 五、任务完成通知机制

### 5.1 OpenClaw Agent 通知

OpenClaw Agent 完成任务后，有两种通知方式：
- **本机目标**：使用原生 `sessions_send`
- **远程目标**：执行 curl 调用 Bridge

### 5.2 Claude Code 通知（curl 方案）

Claude Code 没有 Agent 通信能力。通知通过 **curl 命令**实现，直接写在任务指令里。

CEO 创建 CC 时的任务模板：
```
分析 /data/2026-02-08-小红书数据.json 中的数据。
将报告写入 /reports/2026-02-08-分析.md。

完成后执行以下命令通知 CEO：
curl -s -X POST http://127.0.0.1:9100/message -H 'Content-Type: application/json' \
  -d '{"agent_id":"CEO","from":"tmp-分析","message":"分析完成，报告在 /reports/2026-02-08-分析.md"}'
```

**为什么用 curl 而不用 MCP**：
- MCP 占用大量上下文（tool schema 加载）
- MCP 假设 Agent 支持 MCP 协议，不够 general
- curl 只假设 Agent 能执行 bash——这是最弱的假设，几乎所有 coding agent 都满足
- curl 零额外代码、零额外组件、零上下文开销

---

## 六、主动出击机制

### 6.1 方案：Cron 心跳 + LLM 自主决策

不用复杂的事件系统或规则引擎。用最简单的 cron 定时任务，定期给 CEO 发心跳消息。

### 6.2 心跳由谁发？

**心跳由 Bridge 项目管理，不是 OpenClaw 的内置 Cron。**

链路：
```
系统 cron（Bridge 安装时配置）→ curl → Bridge /message → OC 适配器 → CEO Agent
```

为什么不用 OpenClaw 自己的 Cron：
- Bridge 是独立项目，心跳是 Bridge 的"主动出击"功能
- 如果未来 CEO 换成别的框架，心跳机制不需要改——还是 cron → curl → Bridge
- 这更 general，不绑定 OpenClaw

Bridge 的安装脚本会自动写入系统 cron 配置（`/etc/cron.d/agent-heartbeat`）。

### 6.3 心跳配置

```bash
# 高频：每小时 — 检查紧急事项
0 * * * * curl -s -X POST http://localhost:9100/message -H 'Content-Type: application/json' \
  -d '{"agent_id":"CEO","from":"system","message":"[小心跳] 检查是否有需要处理的事项。"}'

# 中频：每天早上9点 — 规划今天的工作
0 9 * * * curl -s -X POST http://localhost:9100/message -H 'Content-Type: application/json' \
  -d '{"agent_id":"CEO","from":"system","message":"[日心跳] 规划今天的内容生产和实验计划。"}'

# 低频：每周一早上9点 — 复盘和策略调整
0 9 * * 1 curl -s -X POST http://localhost:9100/message -H 'Content-Type: application/json' \
  -d '{"agent_id":"CEO","from":"system","message":"[周心跳] 复盘上周数据，调整策略，更新方法论。"}'
```

### 6.3 为什么这是最 AI-native 的方案

| 方案 | 智能在哪里 | 模型升级后 |
|------|-----------|-----------|
| 规则引擎（if-then） | 在代码里 | 代码不会变聪明 |
| 事件驱动 | 在事件映射里 | 映射不会变聪明 |
| **Cron + LLM 自主决策** | **在 LLM 里** | **模型越强，决策越好** |

### 6.4 创建远程主动出击的 Agent

通过 Bridge `/spawn` 的 `heartbeat` 参数，可以在远程机器上创建自带心跳的 Agent：

```json
{
  "type": "openclaw",
  "agent_id": "实验员",
  "machine": "cloud-b",
  "persistent": true,
  "heartbeat": { "hourly": "[心跳] 检查实验进展，决定下一步行动" }
}
```

Bridge 收到后：在远程机器创建 Agent + 配置 cron 心跳。该 Agent 就成为一个 24h 运行、主动出击的自主 Agent。

---

## 七、上下文管理策略

### 7.1 核心原则：大脑长寿，手脚短命

| 角色 | 运行时长 | 上下文管理 |
|------|---------|-----------|
| CEO（OpenClaw） | 24h+ | OpenClaw 自动压缩记忆 |
| 持久 Agent（OpenClaw） | 24h+ | OpenClaw 自动压缩记忆 |
| Claude Code 执行者 | 分钟~小时 | 每个任务全新 session，用完即弃 |

### 7.2 大任务拆分

CEO 负责将大任务拆成多个小任务，每个小任务一个 CC 实例：

```
CEO：这个分析任务太大，拆成 3 步
  → CC-1：提取并清洗数据 → 结果存文件 → curl 通知 CEO
  → CC-2：基于清洗数据做统计 → 结果存文件 → curl 通知 CEO
  → CC-3：基于统计结果生成报告 → curl 通知 CEO
```

### 7.3 持久化靠文件，不靠上下文

所有重要信息写入文件系统（Git 仓库）：
- 业务数据 → `/data/`
- 分析报告 → `/reports/`
- 生成的文案 → `/drafts/`
- CEO 决策日志 → `/logs/ceo-decisions.md`
- 方法论 → `/01-内容生产/方法论沉淀/`

---

## 八、网络与安装

### 8.1 Tailscale 组网

所有机器安装 Tailscale 后自动组成虚拟局域网：
- 每台机器获得 100.64.x.x 固定 IP
- 所有机器互相可达，不需要管 NAT、防火墙
- 自带 WireGuard 加密

### 8.2 为什么选分布式而非中心化

| 维度 | 中心化 | 分布式（选择） |
|------|--------|--------------|
| 单点故障 | 有 | **无** |
| 本机通信 | 绕公网 | **localhost** |
| 延迟 | 多一跳 | **直连** |
| 实现复杂度 | WebSocket 状态管理 | **无状态 HTTP** |
| 鲁棒性 | 弱 | **强** |

### 8.3 一键安装

**中心服务器**：
```bash
curl -sSL https://your-repo/install.sh | bash -s -- \
  --role=center --tailscale-key=tskey-xxx --machine-id=cloud-a
```
自动安装：Tailscale + Bridge + OpenClaw CEO + Cron 心跳

**工作机器**：
```bash
curl -sSL https://your-repo/install.sh | bash -s -- \
  --role=worker --tailscale-key=tskey-xxx --center-ip=100.64.0.2
```
自动安装：Tailscale + Bridge + 自动注册到集群

**新增机器**：
```bash
curl -sSL https://your-repo/join.sh | bash -s -- --center-ip=100.64.0.2
```

---

## 九、7 大场景验证

| # | 场景 | 实现方式 |
|---|------|---------|
| 1 | OpenClaw Agent → 远程 OpenClaw Agent | curl → Bridge → 远程 Bridge → OC 适配器 → Gateway WebSocket |
| 2 | Agent 远程创建 OpenClaw Agent | curl → Bridge `/spawn` → 远程 Bridge → OC 适配器 → Gateway 创建 session |
| 3 | 远程创建 24h 持续运行的 Agent | `/spawn` + `persistent: true` → 远程 Gateway 持久 session |
| 4 | 远程创建主动出击的 Agent | `/spawn` + `heartbeat` → 远程 Bridge 配置 cron |
| 5 | 人创建远程主动 24h Agent | 人 → CEO → Bridge `/spawn`，或人直接 CLI 调用 Bridge |
| 6 | Agent 创建远程 Claude Code | Bridge `/spawn` + `type: "claude-code"` → CC 适配器 → tmux/Happy |
| 7 | Agent 调用远程 Claude Code | Bridge `/message` → CC 适配器 → tmux send-keys |

---

## 十、CEO Agent 自主决策 Prompt

```
你是一个自主运营的内容业务 CEO Agent。

## 你的职责
- 持续运营内容生产系统，追求北极星指标最大化
- 主动发现机会、设计实验、优化方法论
- 调度集群中的所有 Agent 完成任务

## 通信方式
- 本机 Agent：使用 sessions_send 工具
- 远程 Agent / Claude Code：使用 curl 调用 Bridge API (http://127.0.0.1:9100)

## 收到心跳时的行为

### [小心跳]（每小时）
1. 检查是否有 Agent 汇报了结果需要处理
2. 检查是否有异常（Agent 挂了、任务超时）
3. 如果有待处理事项，立即行动；否则记录"本轮无行动"

### [日心跳]（每天）
1. 读取昨天发布内容的数据表现
2. 识别表现好/差的内容，分析原因
3. 规划今天的内容生产计划
4. 决定是否需要采集新数据、跑新实验
5. 派发任务给相应 Agent

### [周心跳]（每周）
1. 汇总本周数据，对比上周，识别趋势
2. 评估实验，决定继续/终止
3. 更新方法论文档
4. 淘汰低效组件（Agent/Skill/提示词）
5. 生成周报，通知人类

## 决策原则
- 涉及发布内容：必须通知人类审核
- 涉及花钱（API调用超过阈值）：必须通知人类确认
- 纯分析/采集/生成草稿：可以自主执行
- 所有决策记录到 /logs/ceo-decisions.md
```

---

## 十一、实施路径

### Phase 1：基础搭建（1-2天）
1. 所有机器安装 Tailscale
2. 编写 Bridge 核心（`/message` + `/agents` + `/locate`）
3. 编写 OpenClaw 适配器（WebSocket 连接 Gateway）
4. 在 CEO 所在机器部署，验证本机通信

### Phase 2：跨机器通信（2-3天）
1. 第二台机器部署 Bridge
2. 验证跨机器消息投递
3. 编写 Claude Code 适配器
4. 验证 CC 创建 + curl 回调通知

### Phase 3：自主运行（3-5天）
1. 实现 `/spawn` + `/stop` 端点
2. 配置 Cron 心跳
3. 编写 CEO 自主决策 Prompt
4. 系统自主运行 24h，观察行为

### Phase 4：Happy 集成 + 人类监控（可选，3-5天）
1. 部署 Happy Daemon
2. Bridge CC 适配器改为通过 Happy 管理
3. 手机安装 Happy App
4. 配置审批推送

---

## 十二、关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 项目定位 | 独立项目，非 OpenClaw 插件 | 不改源码，适配多框架，保持上游兼容 |
| 架构模式 | 分布式（每机一个 Bridge） | 无单点故障，本机通信零延迟 |
| Agent 通信 | HTTP API + 适配器 | 统一接口，屏蔽框架差异 |
| CC 通知 | curl 命令（写在任务指令中） | 零组件，最 general，只要求能执行 bash |
| 主动出击 | Cron 心跳 + LLM 决策 | 最简单，智能全在 LLM 里 |
| 上下文 | OpenClaw 当大脑，CC 用完即弃 | 避免上下文爆炸 |
| OC Tool 共存 | sessions_send（本地）+ curl（远程） | 不覆盖原生 Tool，各管各的 |
| 网络 | Tailscale | 零配置组网，加密 |
| 安装 | 一键脚本 | 用户只需一行命令 |
| 数据共享 | Git 仓库同步 | 零基础设施，天然版本控制 |

---

## 附录 A：完整消息流示例

### 场景：CEO 自主决策采集数据并生成文案

```
09:00 Cron 发送 [日心跳] → Bridge /message → CEO

09:00 CEO 收到心跳，开始思考
  → curl Bridge /info + /agents（查集群状态）
  → 看到：采集员(空闲), 无其他任务在跑
  → 读取昨天的数据：互动率下降 15%
  → 决策：需要采集新的热点数据

09:01 CEO → curl Bridge /message → 远程 Bridge → OC 适配器 → 采集员
  → 采集员开始工作

09:15 采集员完成 → curl Bridge /message → CEO 所在 Bridge → OC 适配器 → CEO
  → CEO 收到："采集完成，数据在 /data/2026-02-08-热点.json"

09:15 CEO 决策：生成 3 篇文案
  → curl Bridge /spawn (type=claude-code, machine=auto, task="生成文案...")
  → Bridge 选择 local-mac（负载最低）
  → 远程 Bridge → CC 适配器 → tmux 创建 CC 实例

09:16 CC 启动，开始写文案
  → 你的手机收到 Happy 推送（如果已安装）

09:25 CC 完成 → curl Bridge /message → CEO
  → CEO 通过 Telegram 通知你："3篇文案已生成，请审核"
  → CC 实例自动销毁

你审核通过 → Telegram 告诉 CEO → CEO 调度发布流程
```

### 场景：人远程创建 24h 主动出击的 Agent

```
你在手机上 → Telegram → CEO：
  "在 cloud-b 上创建一个实验员，24小时运行，每小时自动检查实验进展"

CEO → curl Bridge /spawn：
  { type: "openclaw", agent_id: "实验员", machine: "cloud-b",
    persistent: true, heartbeat: { hourly: "[心跳] 检查实验进展" } }

Bridge → 远程 Bridge(cloud-b) → OC 适配器 → Gateway 创建 session
Bridge → 配置 cron 心跳

CEO → Telegram → 你："实验员已在 cloud-b 上创建，24h运行，每小时自动检查"

之后每小时：
  cron → curl Bridge /message → 实验员
  → 实验员自主思考、行动
  → 有结果时 → curl Bridge /message → CEO → Telegram → 你
```
