# 配置参考

Agent Bridge 使用两个 JSON 配置文件，首次启动时会自动从 `.example.json` 模板创建。

## bridge.json

本机 Bridge 实例配置，默认路径 `config/bridge.json`。

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
    "openclaw": {
      "gateway": "ws://127.0.0.1:18789",
      "token": "your-gateway-token"
    },
    "claude_code": {
      "tmux_session": "agents"
    }
  }
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `machine_id` | string | 是 | 本机唯一标识，需与 cluster.json 中的 `id` 匹配 |
| `port` | number | 是 | HTTP 服务监听端口 |
| `capabilities` | string[] | 是 | 本机支持的适配器类型：`openclaw`、`claude-code`、`test` |
| `max_agents` | number | 是 | 最大同时运行 Agent 数 |
| `persistent_agents` | object[] | 否 | 持久化 Agent 列表（启动时自动创建） |
| `adapters` | object | 是 | 各适配器的连接配置 |

### persistent_agents

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Agent 唯一标识 |
| `type` | string | 适配器类型：`openclaw` 或 `claude-code` |
| `auto_start` | boolean | 是否在 Bridge 启动时自动创建 |
| `workspace` | string | Agent 工作目录 |

### adapters.openclaw

| 字段 | 类型 | 说明 |
|------|------|------|
| `gateway` | string | OpenClaw Gateway WebSocket 地址，如 `ws://127.0.0.1:18789` |
| `token` | string | Gateway 认证 token |

### adapters.claude_code

| 字段 | 类型 | 说明 |
|------|------|------|
| `tmux_session` | string | tmux session 名称，Agent 窗口将创建在此 session 下 |
| `happy_daemon` | string | （可选）Happy Daemon 路径，用于 Phase 4 集成 |

## cluster.json

集群拓扑配置，默认路径 `config/cluster.json`。单机使用时可不配置。

```json
{
  "machines": [
    { "id": "cloud-a", "bridge": "http://100.64.0.2:9100", "role": "CEO + 调度中心" },
    { "id": "cloud-b", "bridge": "http://100.64.0.3:9100", "role": "采集 + 分析" },
    { "id": "local-mac", "bridge": "http://100.64.0.1:9100", "role": "本地开发 + 创作" }
  ]
}
```

### machines 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 机器标识，需与对应机器的 `bridge.json` 中 `machine_id` 一致 |
| `bridge` | string | 该机器 Bridge 实例的 HTTP 地址 |
| `role` | string | 角色描述（仅用于说明，不影响逻辑） |

## 环境变量

环境变量会覆盖配置文件中的对应值：

| 变量 | 说明 | 示例 |
|------|------|------|
| `PORT` | 覆盖 `bridge.json` 中的 `port` | `PORT=9200` |
| `MACHINE_ID` | 覆盖 `bridge.json` 中的 `machine_id` | `MACHINE_ID=cloud-b` |
| `CONFIG_PATH` | 自定义 bridge 配置文件路径 | `CONFIG_PATH=./my-bridge.json` |
| `CLUSTER_PATH` | 自定义 cluster 配置文件路径 | `CLUSTER_PATH=./my-cluster.json` |
| `LOG_LEVEL` | 日志级别：`debug`、`info`（默认）、`warn`、`error` | `LOG_LEVEL=debug` |

## 配置加载优先级

1. 环境变量（最高优先级）
2. 配置文件中的值
3. 自动从 `.example.json` 创建的默认值（最低优先级）

## CLI 参数

CLI 参数通过设置环境变量间接覆盖配置：

```bash
agent-bridge --debug              # 等同于 LOG_LEVEL=debug
agent-bridge --port 9200          # 等同于 PORT=9200
agent-bridge --config ./path.json # 等同于 CONFIG_PATH=./path.json
```
