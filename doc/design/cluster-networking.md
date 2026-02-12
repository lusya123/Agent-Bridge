# Agent Bridge — 集群组网方案

> Phase 6: Token + Hub Relay 组网设计

## 1. 问题

当前 Agent Bridge 存在以下问题：

| 问题 | 严重程度 | 现状 |
|------|----------|------|
| API 无认证 | 高 | 6 个端点完全开放在公网 |
| 机器间明文通信 | 中 | HTTP 传输 Agent 任务内容 |
| 集群配置是静态的 | 中 | 手写 `cluster.json`，改动需重启所有节点 |
| 无用户隔离 | 中 | 所有机器互相可见 |
| 不支持 NAT 穿透 | 高 | 家里电脑、办公室物理机无法加入集群 |

## 2. 设计目标

**用户体验优先** — 用户只需要复制粘贴一个 Token：

```bash
# 第一台机器（云服务器，有公网 IP）
agent-bridge start
# 输出：
# ✓ Bridge running on :9100
#
# 集群令牌（复制给其他机器）：
# ab_7Kx9mP2qR4sT6u@43.134.124.4:9100

# 后续每台机器（不管在哪、有没有公网 IP）
agent-bridge start --token ab_7Kx9mP2qR4sT6u@43.134.124.4:9100
```

Token 由系统自动生成，包含两部分：
- `ab_7Kx9mP2qR4sT6u` — 随机密钥（128 位，碰撞概率约 2^-128，可忽略）
- `43.134.124.4:9100` — 第一台 Hub 的地址（初始引导用）

**不需要：**
- 注册任何外部服务账号
- 安装额外软件
- 手写配置文件
- 记住任何 IP 地址
- 自己起名字（避免碰撞风险）

## 3. 核心概念

### 3.1 Token — 一个字符串解决所有问题

Token 格式：`<secret>@<hub_address>`

```
ab_7Kx9mP2qR4sT6u@43.134.124.4:9100
└──────────────────┘ └──────────────────┘
    随机密钥（128位）     初始 Hub 地址
```

第一台机器启动时自动生成 Token，用户只需复制粘贴给其他机器。

Token 中的 secret 部分同时承担三个职责：

| 职责 | 机制 |
|------|------|
| **API 认证** | 所有 HTTP/WebSocket 请求携带 `Authorization: Bearer <secret>`，不匹配则拒绝 |
| **集群归属** | 相同 secret 的机器自动组成一个集群 |
| **用户隔离** | 不同 secret 的机器互不可见、互不可达 |

Token 中的地址部分仅用于**初始引导** — 新机器通过它找到第一个 Hub，加入集群后会获得所有 Hub 的地址列表，后续不再依赖初始地址。

**为什么不让用户自己起名？** 如果用户自选 secret（如 `my-key`），全球这么多用户，碰撞概率不可忽略。系统生成 128 位随机密钥，碰撞概率约 2^-128，等同于不可能。

### 3.2 Hub — 有公网 IP 的机器自动成为中继

集群中的机器分两类：

- **Hub 节点**：有公网 IP，能被外部主动连接。第一台启动的机器自动成为 Hub，后续有公网 IP 的机器也可以成为 Hub
- **Edge 节点**：无公网 IP（家里电脑、办公室物理机），通过 Token 中的地址连接到 Hub

Hub 节点之间通过 HTTP 直连，Edge 节点通过 WebSocket 长连接挂在 Hub 上。

## 4. 架构

### 4.1 网络拓扑

```
                    ┌─────────────┐
                    │  Hub A      │
                    │  (云服务器)  │
                    │  公网 IP    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │ HTTP       │ HTTP       │ WebSocket
              ▼            ▼            ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │  Hub B   │  │  Hub C   │  │  Edge D  │
       │ (云服务器)│  │ (云服务器)│  │ (家里电脑)│
       │ 公网 IP  │  │ 公网 IP  │  │ 无公网 IP │
       └────┬─────┘  └──────────┘  └──────────┘
            │ WebSocket
            ▼
       ┌──────────┐
       │  Edge E  │
       │(办公室机器)│
       │ 无公网 IP │
       └──────────┘
```

- Hub ↔ Hub：HTTP 直连（无状态，和现有逻辑一致）
- Edge → Hub：WebSocket 长连接（Edge 主动发起，Hub 通过此连接推送消息）
- Edge ↔ Edge：不直连，通过 Hub 中继

### 4.2 消息路由

消息从 Agent X（在机器 A 上）发送到 Agent Y（在机器 D 上）：

```
Agent X → Bridge A (本地 API)
       → Router 查找 Agent Y 所在机器 = D
       → D 是 Edge 节点，挂在 Hub A 上
       → 通过 WebSocket 推送给 D
       → Bridge D 收到消息
       → 本地适配器投递给 Agent Y
```

如果 Agent Y 在 Hub B 上（有公网 IP）：

```
Agent X → Bridge A → HTTP POST 到 Hub B → Bridge B → Agent Y
```

路由决策逻辑：

1. 目标在本机 → 本地适配器直投
2. 目标在 Hub 节点 → HTTP 转发
3. 目标在 Edge 节点 → 找到该 Edge 连接的 Hub，通过 WebSocket 中继

## 5. 动态集群发现

不再需要手写 `cluster.json`。机器加入和离开集群完全自动化。

### 5.1 加入流程

```
新机器启动（带 --token）
  │
  ├─ 解析 Token → 提取 secret + hub_address
  │
  ├─ 本机有公网 IP？（可通过 --public-ip 显式声明，或自动检测）
  │   │
  │   ├─ 是 → Hub 节点
  │   │    → HTTP POST /cluster/join 到 hub_address
  │   │      （携带 secret + machine_id + bridge_url + capabilities）
  │   │    → Hub 验证 secret
  │   │    → Hub 将新成员加入集群列表
  │   │    → Hub 返回完整集群成员列表（含所有 Hub 地址）
  │   │    → Hub 广播「新成员加入」给所有已连接的节点
  │   │    → 新 Hub 与其他 Hub 建立互相心跳
  │   │
  │   └─ 否 → Edge 节点
  │        → WebSocket 连接到 hub_address（ws://hub:port/cluster/ws）
  │        → 发送 join 请求（携带 secret + machine_id + capabilities）
  │        → Hub 验证 secret
  │        → Hub 将新成员加入集群列表
  │        → Hub 返回完整集群成员列表（含所有 Hub 地址）
  │        → Hub 广播「新成员加入」给所有已连接的节点
  │        → Edge 记住所有 Hub 地址（用于容灾切换）
  │
  └─ 无 --token（第一台机器）
      → 生成随机 secret（128 位）
      → 检测本机公网 IP
      → 生成 Token：<secret>@<public_ip>:<port>
      → 打印 Token，等待其他机器加入
```

### 5.2 离开/掉线

- **Edge 节点**：WebSocket 断开 → Hub 检测到 → 从列表移除 → 广播给其他节点
- **Hub 节点**：其他 Hub 定期心跳检测（HTTP GET /health）→ 超时未响应 → 标记离线 → 广播
- 节点重新上线时自动重新加入（Edge 自动重连 WebSocket，Hub 重新 join）

### 5.3 集群状态同步

每个节点维护一份集群成员列表（内存中），包含：

```typescript
interface ClusterMember {
  machine_id: string;
  type: 'hub' | 'edge';
  bridge_url?: string;       // Hub 节点的公网地址
  connected_hub?: string;    // Edge 节点连接的 Hub machine_id
  capabilities: string[];
  agents: string[];          // 该机器上运行的 Agent 列表
  last_seen: number;         // 最后心跳时间
}
```

## 6. 连接协议

### 6.1 Edge → Hub WebSocket 握手

```
Edge 解析 Token，提取 hub_address
Edge 发起 WebSocket 连接: ws://hub_address/cluster/ws

连接建立后，Edge 发送 join 帧：
{
  "type": "join",
  "secret": "ab_7Kx9mP2qR4sT6u",
  "machine_id": "home-pc",
  "capabilities": ["openclaw", "claude-code"]
}

Hub 验证 secret，成功则返回：
{
  "type": "welcome",
  "members": [ ... ],        // 完整集群成员列表
  "hub_id": "cloud-a"
}

Secret 不匹配则断开连接：
{
  "type": "error",
  "code": "AUTH_FAILED",
  "message": "Invalid secret"
}
```

### 6.2 Hub → Hub 注册

```
POST /cluster/join
Authorization: Bearer <secret>
{
  "machine_id": "cloud-b",
  "bridge_url": "http://150.109.16.237:9100",
  "capabilities": ["openclaw"]
}

→ 200 OK
{
  "members": [ ... ]    // 含所有 Hub 地址，新 Hub 可与它们建立心跳
}
```

### 6.3 消息中继（Hub → Edge）

当 Hub 需要把消息转发给挂在它上面的 Edge 节点时，通过 WebSocket 推送：

```json
{
  "type": "relay",
  "payload": {
    "path": "/message",
    "body": {
      "agent_id": "worker-1",
      "message": "请分析这份报告",
      "from": "ceo"
    }
  }
}
```

Edge 收到后在本地处理，等同于直接收到 HTTP 请求。

### 6.4 心跳保活

- Edge → Hub：每 30 秒发送 `{"type": "ping"}`
- Hub 回复 `{"type": "pong"}`
- 连续 3 次 ping 无 pong → 判定断连 → 自动重连
- Hub → Hub：每 60 秒 HTTP GET `/health`

## 7. 高可用

### 7.1 多 Hub 自动容灾

Edge 节点加入集群后，会从 welcome 响应中获得所有 Hub 的地址列表。当前连接的 Hub 断开时，自动切换到其他 Hub：

```
Edge 加入集群 → 获得 Hub 列表 [A, B, C]
  → 当前连接 Hub A
  → Hub A 断开
  → 自动连接 Hub B（无需用户干预）
  → Hub B 也断了
  → 自动连接 Hub C
  → 所有 Hub 都不可达 → 指数退避重试
```

用户不需要手动指定多个 Hub 地址，集群信息在加入时自动同步。

### 7.2 Hub 之间同步

Hub 节点之间互相知道对方（通过 join 注册），任何一个 Hub 收到新成员加入/离开，都会通知其他 Hub。

即使 Hub A 挂了：
- 挂在 Hub A 上的 Edge 节点自动重连到 Hub B
- Hub B 已经有完整的集群信息
- 消息路由自动切换

### 7.3 唯一限制

**至少需要一台有公网 IP 的机器**作为 Hub。如果所有 Hub 都挂了，Edge 节点之间无法通信。这是 NAT 的物理限制，无法绕过。

## 8. API 变更

### 8.1 新增端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/cluster/join` | POST | Hub 节点注册到集群 |
| `/cluster/members` | GET | 查看集群成员列表 |
| `/cluster/ws` | WebSocket | Edge 节点连接入口 |
| `/health` | GET | 健康检查（Hub 间心跳） |

### 8.2 现有端点变更

所有现有端点（`/info`、`/agents`、`/locate`、`/message`、`/spawn`、`/stop`）新增认证：

```
Authorization: Bearer <secret>
```

缺失或不匹配返回 `401 Unauthorized`。

### 8.3 `/agents` 增强

```
GET /agents              → 本机 Agent（向后兼容）
GET /agents?scope=cluster → 集群所有机器的 Agent（新增）
```

## 9. CLI 变更

```bash
# 第一台机器（自动生成 Token）
agent-bridge start
# 输出 Token，用户复制给其他机器

# 后续机器（粘贴 Token 即可）
agent-bridge start --token <token>

# 有公网 IP 的后续机器（显式声明，成为 Hub 节点）
agent-bridge start --token <token> --public-ip 150.109.16.237

# 其他参数不变
--port 9100      # 监听端口
--debug          # 调试日志
--config ./x.json # 自定义配置
```

Token 会持久化到本地（`~/.agent-bridge/token`），重启时自动读取，无需重复输入。

## 10. 实现计划

### Phase 6a：认证 + 集群基础

1. Token 生成与解析（secret + hub_address）
2. Token 持久化（`~/.agent-bridge/token`）
3. Secret 认证中间件（所有端点）
4. `ClusterManager` 类 — 成员列表管理（内存）
5. `/cluster/join` + `/cluster/members` + `/health` 端点
6. CLI `--token` 和 `--public-ip` 参数
7. Hub → Hub 注册 + 心跳
8. 替换静态 `cluster.json` 为动态发现
9. 单元测试

### Phase 6b：WebSocket 中继 + Edge 节点

1. `/cluster/ws` WebSocket 服务端（Hub 侧）
2. WebSocket 客户端（Edge 侧）— 连接、认证、自动重连
3. 消息中继逻辑（Hub 转发给 Edge）
4. 公网 IP 自动检测 + `--public-ip` 显式声明
5. Router 适配 — 识别 Edge 节点，走 WebSocket 中继
6. 多 Hub 自动容灾（从 welcome 获取 Hub 列表，断线自动切换）
7. 单元测试 + 集成测试

### Phase 6c：增强

1. `/agents?scope=cluster` 全局视图
2. 节点上下线广播
3. Edge 节点 Agent 信息同步到 Hub
4. 云服务器 E2E 验证

## 11. 与现有代码的关系

| 现有模块 | 变更 |
|----------|------|
| `src/router.ts` | 新增 Edge 中继路由逻辑 |
| `src/index.ts` | 初始化 ClusterManager，注册新端点 |
| `src/config.ts` | 新增 token 配置项 |
| `src/cli.ts` | 新增 --token / --public-ip 参数 |
| `config/cluster.json` | 废弃，改为动态发现 |
| 所有 API 端点 | 添加认证中间件 |

新增模块：
- `src/cluster.ts` — ClusterManager（成员管理 + 广播）
- `src/middleware/auth.ts` — Secret 认证中间件
- `src/cluster-ws.ts` — WebSocket 中继服务端 + 客户端
- `src/token.ts` — Token 生成、解析、持久化
