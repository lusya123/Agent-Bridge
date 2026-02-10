# 部署指南

## 前置要求

- Node.js >= 18
- 如使用 OpenClaw 适配器：需要运行中的 OpenClaw Gateway（端口 18789）
- 如使用 Claude Code 适配器：需要安装 tmux
- 多机部署：推荐 Tailscale VPN 组网

## 单机部署

适用于开发测试或只有一台机器的场景。

```bash
# 安装
git clone https://github.com/user/agent-bridge.git
cd agent-bridge
npm install
npm run build

# 编辑配置
vim config/bridge.json

# 启动
node dist/cli.js
```

或使用一键安装脚本：

```bash
curl -sSL https://your-repo/scripts/install.sh | bash
agent-bridge
```

安装脚本会：
1. 检查 Node.js >= 18
2. 克隆到 `~/.agent-bridge`
3. 编译并创建 `/usr/local/bin/agent-bridge` 软链接

## 多机部署

### 第一步：组网

推荐使用 [Tailscale](https://tailscale.com/) 让所有机器互通：

```bash
# 每台机器上执行
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

加入同一网络后，每台机器会获得 `100.64.x.x` 固定 IP。

### 第二步：每台机器安装 Bridge

```bash
git clone https://github.com/user/agent-bridge.git
cd agent-bridge
npm install && npm run build
```

### 第三步：配置

每台机器编辑自己的 `config/bridge.json`，设置唯一 `machine_id`：

**Machine A (cloud-a):**
```json
{
  "machine_id": "cloud-a",
  "port": 9100,
  "capabilities": ["openclaw"],
  "max_agents": 5,
  "adapters": {
    "openclaw": {
      "gateway": "ws://127.0.0.1:18789",
      "token": "your-gateway-token"
    }
  }
}
```

**Machine B (cloud-b):**
```json
{
  "machine_id": "cloud-b",
  "port": 9100,
  "capabilities": ["claude-code"],
  "max_agents": 3,
  "adapters": {
    "claude_code": {
      "tmux_session": "agents"
    }
  }
}
```

所有机器使用相同的 `config/cluster.json`：

```json
{
  "machines": [
    { "id": "cloud-a", "bridge": "http://100.64.0.2:9100", "role": "调度中心" },
    { "id": "cloud-b", "bridge": "http://100.64.0.3:9100", "role": "执行节点" }
  ]
}
```

### 第四步：启动

每台机器启动 Bridge 即可，消息会自动跨机器路由。

## 进程管理

### 使用 screen（推荐用于快速部署）

```bash
# 启动
screen -dmS bridge bash -c 'cd /path/to/agent-bridge && node dist/cli.js'

# 查看日志
screen -r bridge

# 退出查看（不终止进程）
# 按 Ctrl+A 然后按 D
```

### 使用 systemd（推荐用于生产环境）

创建 `/etc/systemd/system/agent-bridge.service`：

```ini
[Unit]
Description=Agent Bridge
After=network.target

[Service]
Type=simple
WorkingDirectory=/path/to/agent-bridge
ExecStart=/usr/bin/node dist/cli.js
Restart=on-failure
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable agent-bridge
sudo systemctl start agent-bridge

# 查看日志
journalctl -u agent-bridge -f
```

## 防火墙配置

Bridge 需要开放 HTTP 端口（默认 9100），注意**两层防火墙都要配置**：

### 1. OS 防火墙

```bash
# CentOS / OpenCloudOS
sudo firewall-cmd --add-port=9100/tcp --permanent
sudo firewall-cmd --reload

# Ubuntu
sudo ufw allow 9100/tcp
```

### 2. 云厂商安全组

在云控制台（腾讯云、阿里云等）的安全组规则中添加入站规则：

| 协议 | 端口 | 来源 |
|------|------|------|
| TCP | 9100 | 仅允许集群内 IP（或 Tailscale 网段 100.64.0.0/10） |

> 如果使用 Tailscale 组网，流量走 VPN 隧道，通常不需要在云安全组开放端口。但如果直接用公网 IP 通信，则必须配置安全组。

## OpenClaw Gateway 前置要求

使用 OpenClaw 适配器的机器需要先部署 OpenClaw Gateway：

1. Gateway 默认监听 `127.0.0.1:18789`
2. 获取 Gateway 的认证 token，填入 `bridge.json` 的 `adapters.openclaw.token`
3. 确认 Gateway 已启动并可连接

验证 Gateway 状态：

```bash
# 检查端口是否在监听
ss -tlnp | grep 18789
```

## 验证部署

部署完成后验证各节点状态：

```bash
# 检查本机 Bridge
curl http://localhost:9100/info

# 检查远程节点
curl http://100.64.0.2:9100/info

# 检查 Agent 列表
curl http://localhost:9100/agents

# 跨机器定位 Agent
curl "http://localhost:9100/locate?agent_id=ceo"
```
