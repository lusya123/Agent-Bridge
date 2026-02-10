# 故障排查

## 开启 Debug 日志

排查问题时，首先开启 debug 级别日志获取详细信息：

```bash
# 方式一：CLI 参数
agent-bridge --debug

# 方式二：环境变量
LOG_LEVEL=debug node dist/cli.js
```

日志格式：`[HH:MM:SS] [LEVEL] [TAG] message`

日志级别从低到高：`debug` → `info` → `warn` → `error`

## 常见问题

### Bridge 启动失败

**症状：** 启动时报错 `Bridge config not found`

**原因：** 配置文件不存在且没有 `.example.json` 模板

**解决：**
```bash
# 确认 config 目录下有模板文件
ls config/*.example.json

# 如果模板文件存在，首次启动会自动复制
# 如果模板也不存在，手动创建配置文件
cp config/bridge.example.json config/bridge.json
```

---

### OpenClaw Gateway 连接失败

**症状：** 日志中出现 `WebSocket connection failed` 或 `connect ECONNREFUSED`

**排查步骤：**

1. 确认 Gateway 正在运行：
```bash
ss -tlnp | grep 18789
```

2. 确认 `bridge.json` 中 gateway 地址正确：
```json
"openclaw": {
  "gateway": "ws://127.0.0.1:18789",
  "token": "your-token"
}
```

3. 确认 token 有效（从 Gateway 配置中获取）

4. OpenClaw 适配器会自动重连（指数退避），等待几秒查看是否恢复

---

### Gateway 握手失败

**症状：** WebSocket 连接成功但握手被拒绝

**常见原因：**
- token 错误或过期
- Gateway 版本不兼容

**解决：** 检查 Gateway 日志确认拒绝原因，更新 token

---

### 跨机器通信失败

**症状：** `/message` 或 `/locate` 返回 `REMOTE_UNREACHABLE` 或 `AGENT_NOT_FOUND`

**排查步骤：**

1. 确认两台机器网络互通：
```bash
# 从 A 机器 ping B 机器
ping 100.64.0.3

# 或直接测试 Bridge 端口
curl http://100.64.0.3:9100/info
```

2. 检查 `cluster.json` 配置是否一致（所有机器使用相同的集群配置）

3. 检查防火墙（两层都要开）：
```bash
# OS 防火墙
sudo firewall-cmd --list-ports    # CentOS
sudo ufw status                   # Ubuntu

# 云安全组：在云控制台检查入站规则是否允许 9100 端口
```

4. 如果使用 Tailscale，确认两台机器都已加入：
```bash
tailscale status
```

---

### Agent 创建（spawn）失败

**症状：** `/spawn` 返回 `SPAWN_FAILED`

**排查步骤：**

1. 确认 `type` 与本机 `capabilities` 匹配
2. 检查 `max_agents` 限制
3. 对于 OpenClaw 类型：确认 Gateway 连接正常
4. 对于 Claude Code 类型：确认 tmux session 存在
```bash
tmux list-sessions
```

---

### Agent 停止失败

**症状：** `/stop` 返回 `ADAPTER_NO_STOP` 或 `STOP_FAILED`

**可能原因：**
- `ADAPTER_NO_STOP`：该适配器未实现 stop 方法
- `STOP_FAILED`：底层框架操作失败

**解决：** 查看 `detail` 字段中的具体错误信息

---

### 心跳不生效

**症状：** Agent 创建时配置了 heartbeat 但没有定时收到消息

**排查步骤：**

1. 开启 debug 日志查看心跳调度注册信息
2. 确认 cron 表达式正确（自定义表达式需要是合法的 5 位 cron 格式）
3. 检查 `data/heartbeats.json` 中是否有对应记录
4. 心跳通过 HTTP 调用本机 `/message` 端点，确认 Bridge 服务正常运行

## 调试技巧

### 检查 Bridge 状态

```bash
# 本机信息
curl http://localhost:9100/info | jq .

# Agent 列表
curl http://localhost:9100/agents | jq .

# 定位某个 Agent
curl "http://localhost:9100/locate?agent_id=ceo" | jq .
```

### 手动测试消息投递

```bash
# 发送测试消息
curl -X POST http://localhost:9100/message \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "ceo", "from": "debug", "message": "test ping"}'
```

### 检查持久化数据

```bash
# 心跳调度数据
cat data/heartbeats.json | jq .
```
