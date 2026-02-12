# Agent Bridge — 待解决问题清单

> 截至 Phase 5.5 完成（2026-02-10），已实现核心通信能力，以下问题尚未解决。
>
> **更新（2026-02-12）：** Phase 6 集群组网方案已设计完成（[`doc/design/cluster-networking.md`](design/cluster-networking.md)），将解决 1.1、1.2、2.1、2.2、2.3、3.1 等问题。

---

## 1. 安全

### 1.1 Bridge HTTP API 无认证

**严重程度：高**

当前 6 个 API 端点（`/info`、`/agents`、`/locate`、`/message`、`/spawn`、`/stop`）完全开放，无任何认证机制。任何知道公网 IP 的人都能：
- 查看所有 Agent 信息
- 给任意 Agent 发消息
- 创建/停止 Agent

**影响范围：** 所有端点、所有部署环境

**可能方案：**
- API Key / Bearer Token 认证（最简单）
- 机器间通信用 mTLS
- 限制监听地址为 Tailscale 内网（网络层隔离）

### 1.2 机器间通信无加密

**严重程度：中**

Bridge 之间通过 HTTP 明文传输消息，包括 Agent 任务内容、回调结果等。在公网环境下存在窃听风险。

**影响范围：** 跨机器路由（Router 转发 `/message`、`/spawn`）

**可能方案：**
- 使用 Tailscale 组网（WireGuard 加密，最推荐）
- Bridge 之间启用 HTTPS

---

## 2. 集群与网络

### 2.1 集群发现是静态配置

**严重程度：中**

当前每台机器的 `config/cluster.json` 手工写死所有机器地址。添加或移除机器需要修改所有节点的配置文件并重启。

**影响范围：** 集群扩缩容、新用户接入

**当前状态：**
```json
{
  "machines": [
    { "id": "cloud-a", "bridge": "http://43.134.124.4:9100" },
    { "id": "cloud-b", "bridge": "http://150.109.16.237:9100" }
  ]
}
```

**可能方案：**
- Tailscale + MagicDNS（每个 tailnet 内自动发现）
- 轻量注册中心（Bridge 启动时向协调点注册）
- 对于少量机器（2~5 台），静态配置足够用

### 2.2 无用户/租户隔离

**严重程度：中（多用户场景下为高）**

所有在 `cluster.json` 里的机器互相可见，没有"这些机器属于用户 1，那些机器属于用户 2"的概念。

**影响范围：** 多用户/多租户部署

**可能方案：**
- Tailscale tailnet 天然隔离（每个用户一个 tailnet，推荐）
- 中心化服务按用户分组

### 2.3 没有使用 Tailscale 组网

**严重程度：低（当前两台测试服务器可接受）**

当前直接用公网 IP 互连，`cluster.example.json` 里的 `100.64.x.x` 地址只是模板。

**影响范围：** 安全性、NAT 穿透、用户隔离

---

## 3. Agent 可见性

### 3.1 `/agents` 只返回本机 Agent

**严重程度：低**

`GET /agents` 只查询本机适配器的 sessions，不聚合集群其他机器的 Agent。Plugin 的 `bridge_agents` 工具同样只看到本机。

**影响范围：** Agent 全局视图、`bridge_agents` 工具

**当前行为：**
- 在 cloud-a 调 `/agents` → 只返回 cloud-a 的 agent
- 要看 cloud-b 的 agent 需要直接调 cloud-b 的 `/agents`

**可能方案：**
- `/agents` 增加 `?scope=cluster` 参数，遍历集群所有机器汇总
- 或新增 `/agents/all` 端点

### 3.2 同名 Agent 无法自动区分

**严重程度：低（Phase 5.5 已缓解）**

两台机器都有 `main` agent 时，Router 自动路由总是匹配本机。Phase 5.5 添加了 `machine` 参数作为显式指定的手段，但 Agent 需要知道目标机器 ID。

**当前缓解措施：** `bridge_message` 和 `bridge_spawn` 的 `machine` 参数

---

## 4. 可靠性

### 4.1 回调机制依赖 LLM 自觉执行

**严重程度：中**

Phase 5.5 的回调指令是注入到 task 消息末尾的自然语言指令。LLM 可能：
- 忘记回调
- 回调格式错误
- 因 token 限制截断回调指令

**影响范围：** 跨机器 spawn 后的结果回传

**可能方案：**
- Bridge 层面实现任务状态追踪（spawn 时记录，等待回调，超时告警）
- 回调作为系统级机制而非 LLM 指令

### 4.2 消息无持久化/队列

**严重程度：低（当前场景）**

如果目标 Agent 不在线或 Bridge 不可达，消息直接丢失，没有重试或队列机制。

**影响范围：** 离线 agent、网络抖动

### 4.3 Agent 状态无同步

**严重程度：低**

Bridge 不知道 Agent 何时完成任务、何时空闲。`/agents` 返回的 status 来自 Gateway sessions，但不反映 LLM 是否正在处理。

---

## 5. 运维

### 5.1 Gateway 重启后 Bridge 重连

**严重程度：低**

OpenClaw 适配器有自动重连逻辑（指数退避），但实测中偶尔需要手动重启 Bridge。需要更多稳定性验证。

### 5.2 无监控/告警

**严重程度：低（当前两台测试服务器）**

Bridge 挂了、Gateway 断连、Agent 卡死，没有任何告警机制。

**可能方案：**
- `/health` 端点 + 外部监控
- Bridge 互相心跳检测

### 5.3 Phase 6（Happy 集成 + 人类监控）未开始

**严重程度：—（规划中）**

CHANGELOG 中记录的下一步：
- 部署 Happy Daemon
- Bridge CC 适配器改为通过 Happy 管理
- 手机安装 Happy App
- 配置审批推送

---

## 优先级建议

| 优先级 | 问题 | 理由 |
|--------|------|------|
| P0 | 1.1 API 无认证 | 公网暴露，安全风险最高 | Phase 6 Token 认证 |
| P0 | 不支持 NAT 穿透 | 家里电脑/办公室机器无法加入 | Phase 6 Edge WebSocket |
| P1 | 2.3 Tailscale 组网 | 同时解决 1.2 加密 + 2.2 用户隔离 | Phase 6 Token 隔离替代 |
| P1 | 4.1 回调可靠性 | 跨机器协作的核心体验 | 待定 |
| P2 | 2.1 动态集群发现 | 当前 2 台机器静态配置够用 | Phase 6 动态发现 |
| P2 | 3.1 全局 Agent 视图 | 改动量小，体验提升明显 | Phase 6c |
| P3 | 4.2 消息持久化 | 当前场景丢消息概率低 | — |
| P3 | 5.2 监控告警 | 规模小时手动检查可接受 | — |
