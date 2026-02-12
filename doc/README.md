# Agent Bridge 文档

## 用户文档

面向使用 Agent Bridge 的用户：

- [配置参考](configuration.md) — bridge.json / cluster.json 字段详解、环境变量、CLI 参数
- [部署指南](deployment.md) — 单机/多机部署、Tailscale 组网、进程管理、防火墙配置
- [API 参考](api-reference.md) — 6 个端点完整格式、错误码一览、跨机器路由行为
- [故障排查](troubleshooting.md) — 常见问题及解决方案、调试技巧

## 设计文档

面向理解系统架构的开发者：

- [完整技术方案](design/Agent-Bridge-完整技术方案.md) — 系统架构、技术选型、实施路线图
- [OpenClaw Gateway 协议](design/openclaw-gateway.md) — Gateway WebSocket RPC 协议参考

## 项目管理

- [待解决问题清单](open-issues.md) — 按优先级排列的已知问题（安全、集群、可靠性等）
- [更新日志](../CHANGELOG.md) — 版本历史和进度追踪

## 历史文档

已完成的需求和设计文档归档在 [archive/](archive/) 目录。
