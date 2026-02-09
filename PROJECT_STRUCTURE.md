# Agent Bridge 项目目录结构

```
Agent-Bridge/
├── CLAUDE.md                          # Claude Code 项目上下文
├── README.md                          # 项目说明（后续补充）
├── package.json                       # Node.js 项目配置
├── tsconfig.json                      # TypeScript 配置
├── .env.example                       # 环境变量模板
├── .gitignore
│
├── doc/                               # 技术文档（已有）
│   └── Agent-Bridge-完整技术方案.md
│
├── config/                            # 配置文件
│   ├── bridge.example.json            # 本机 Bridge 配置模板
│   └── cluster.example.json           # 集群机器列表模板
│
├── src/                               # 源码
│   ├── index.ts                       # 入口：启动 HTTP 服务
│   ├── config.ts                      # 配置加载
│   ├── router.ts                      # 路由层（本机/远程转发）
│   │
│   ├── api/                           # HTTP API 层（6 个端点）
│   │   ├── info.ts                    # GET  /info
│   │   ├── agents.ts                  # GET  /agents
│   │   ├── locate.ts                  # GET  /locate
│   │   ├── message.ts                 # POST /message
│   │   ├── spawn.ts                   # POST /spawn
│   │   └── stop.ts                    # POST /stop
│   │
│   └── adapters/                      # 适配器层
│       ├── types.ts                   # 适配器统一接口定义
│       ├── openclaw.ts                # OpenClaw 适配器（WebSocket）
│       ├── claude-code.ts             # Claude Code 适配器（tmux）
│       └── generic.ts                 # 通用适配器（预留）
│
├── scripts/                           # 安装与运维脚本
│   ├── install.sh                     # 一键安装（--role=center/worker）
│   ├── join.sh                        # 新机器加入集群
│   └── heartbeat-cron.sh             # 心跳 cron 配置脚本
│
└── test/                              # 测试
    ├── api/                           # API 端点测试
    ├── adapters/                      # 适配器测试
    └── integration/                   # 集成测试（跨机器模拟）
```

## 技术选型

| 类别 | 选择 | 理由 |
|------|------|------|
| 语言 | TypeScript（Node.js） | 类型安全，生态丰富 |
| HTTP 框架 | Hono | 轻量、零依赖、性能好 |
| WebSocket | ws | 连接 OpenClaw Gateway |
| 进程管理 | tmux | 管理 Claude Code 实例 |
| 测试 | vitest | 快速、TypeScript 原生支持 |

预估总代码量：~320 行
