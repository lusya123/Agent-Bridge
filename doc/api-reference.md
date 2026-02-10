# API 参考

所有端点监听在 `http://<machine>:<port>`（默认端口 9100）。

请求和响应均使用 JSON 格式。

## GET /info

返回本机 Bridge 实例信息。

**请求：** 无参数

**响应：**

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
    {
      "id": "ceo",
      "type": "openclaw",
      "status": "running",
      "description": "CEO Agent"
    }
  ]
}
```

**示例：**

```bash
curl http://localhost:9100/info
```

---

## GET /agents

列出本机所有运行中的 Agent。

**请求：** 无参数

**响应：**

```json
[
  {
    "id": "ceo",
    "type": "openclaw",
    "status": "running",
    "persistent": true,
    "task": "负责全局调度",
    "description": "CEO Agent"
  }
]
```

**AgentInfo 字段：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | Agent 唯一标识 |
| `type` | string | 适配器类型：`openclaw`、`claude-code`、`generic` |
| `status` | string | 状态：`running`、`idle`、`stopped` |
| `persistent` | boolean | 是否为持久化 Agent |
| `task` | string? | 当前任务描述 |
| `description` | string? | Agent 说明 |

**示例：**

```bash
curl http://localhost:9100/agents
```

---

## GET /locate

在集群中定位 Agent 所在机器。会先查本机，再遍历集群中的其他机器。

**请求参数（Query）：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | 要定位的 Agent ID |

**成功响应（200）：**

```json
{
  "agent_id": "ceo",
  "machine": "cloud-a",
  "bridge": "http://100.64.0.2:9100",
  "type": "openclaw"
}
```

**错误响应：**

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | `MISSING_AGENT_ID` | 未提供 agent_id 参数 |
| 404 | `AGENT_NOT_FOUND` | Agent 在集群中未找到 |
| 502 | `REMOTE_UNREACHABLE` | 无法完整查询集群（部分节点不可达） |

**示例：**

```bash
curl "http://localhost:9100/locate?agent_id=ceo"
```

---

## POST /message

发消息给 Agent。如果目标 Agent 不在本机，会自动转发到集群中的目标机器。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | 目标 Agent ID |
| `from` | string | 否 | 发送者标识，默认 `anonymous` |
| `message` | string | 是 | 消息内容 |

**成功响应（200）：**

```json
{ "ok": true }
```

**错误响应：**

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | `MISSING_FIELDS` | 缺少 agent_id 或 message |
| 500 | `INTERNAL_ERROR` | 消息投递失败 |

**示例：**

```bash
curl -X POST http://localhost:9100/message \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "ceo", "from": "user", "message": "检查今天的任务"}'
```

---

## POST /spawn

创建新 Agent。支持指定目标机器（远程创建）、持久化、心跳调度。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | 是 | 适配器类型：`openclaw`、`claude-code` |
| `agent_id` | string | 否 | Agent ID，不填则自动生成 |
| `task` | string | 是 | Agent 任务描述 |
| `machine` | string | 否 | 目标机器 ID，默认本机 |
| `persistent` | boolean | 否 | 是否持久化 |
| `heartbeat` | object | 否 | 心跳调度配置（见下表） |

**心跳调度：**

`heartbeat` 是一个键值对，key 为调度名称或 cron 表达式，value 为要发送的消息：

| 预定义 Key | Cron 表达式 | 说明 |
|------------|------------|------|
| `hourly` | `0 * * * *` | 每小时整点 |
| `daily_9am` | `0 9 * * *` | 每天早上 9 点 |
| `weekly_monday` | `0 9 * * 1` | 每周一早上 9 点 |
| 自定义 cron | 用户提供 | 任意合法 cron 表达式 |

**成功响应（200）：**

```json
{
  "ok": true,
  "agent_id": "analyzer",
  "machine": "cloud-a"
}
```

**错误响应：**

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | `MISSING_FIELDS` | 缺少 type 或 task |
| 400 | `NO_ADAPTER` | 本机没有该类型的适配器 |
| 404 | `MACHINE_NOT_FOUND` | 指定的目标机器不在集群中 |
| 500 | `SPAWN_FAILED` | 创建 Agent 失败 |
| 502 | `REMOTE_UNREACHABLE` | 无法连接目标机器 |

**示例：**

```bash
# 本机创建
curl -X POST http://localhost:9100/spawn \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "claude-code",
    "agent_id": "analyzer",
    "task": "分析数据报告"
  }'

# 远程创建（在 cloud-b 上创建）
curl -X POST http://localhost:9100/spawn \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "openclaw",
    "agent_id": "worker-1",
    "task": "采集数据",
    "machine": "cloud-b"
  }'

# 带心跳调度
curl -X POST http://localhost:9100/spawn \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "openclaw",
    "agent_id": "monitor",
    "task": "监控服务状态",
    "heartbeat": {
      "hourly": "[心跳] 检查服务状态",
      "daily_9am": "[日报] 生成监控报告"
    }
  }'
```

---

## POST /stop

停止 Agent 并清理其心跳调度。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | 要停止的 Agent ID |

**成功响应（200）：**

```json
{ "ok": true }
```

**错误响应：**

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | `MISSING_AGENT_ID` | 未提供 agent_id |
| 400 | `ADAPTER_NO_STOP` | 该适配器不支持 stop 操作 |
| 404 | `AGENT_NOT_FOUND` | Agent 未找到 |
| 500 | `STOP_FAILED` | 停止 Agent 失败 |

**示例：**

```bash
curl -X POST http://localhost:9100/stop \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "analyzer"}'
```

---

## 错误响应格式

所有错误响应使用统一格式：

```json
{
  "error_code": "AGENT_NOT_FOUND",
  "error": "Agent \"xyz\" not found",
  "detail": "optional additional context"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `error_code` | string | 机器可读的错误码（见下表） |
| `error` | string | 人类可读的错误描述 |
| `detail` | string? | 可选的详细信息（如底层异常信息） |

## 错误码一览

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `MISSING_AGENT_ID` | 400 | 请求缺少 agent_id 参数 |
| `MISSING_FIELDS` | 400 | 请求缺少必填字段 |
| `NO_ADAPTER` | 400 | 本机没有请求的适配器类型 |
| `ADAPTER_NO_STOP` | 400 | 该适配器不支持 stop 操作 |
| `AGENT_NOT_FOUND` | 404 | Agent 在本机或集群中未找到 |
| `MACHINE_NOT_FOUND` | 404 | 指定的目标机器不在集群配置中 |
| `INTERNAL_ERROR` | 500 | 服务内部错误 |
| `SPAWN_FAILED` | 500 | 创建 Agent 失败 |
| `STOP_FAILED` | 500 | 停止 Agent 失败 |
| `REMOTE_UNREACHABLE` | 502 | 无法连接远程 Bridge 节点 |

## 跨机器路由行为

- **POST /message**：先查本机，本机没有则遍历集群转发，全部失败返回 404
- **POST /spawn**：指定 `machine` 时 HTTP 转发到目标机器，不指定则本机创建
- **GET /locate**：先查本机，再并发查询所有集群节点
- **GET /info** 和 **GET /agents**：仅返回本机数据，不涉及跨机器
