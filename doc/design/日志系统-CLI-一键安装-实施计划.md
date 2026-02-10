# 日志系统 + CLI + 一键安装 — 实施计划

> 状态：待实施
> 日期：2026-02-10
> 前置条件：Phase 1-3 全部完成（46 tests, 10 files, all passed）

## 目标

用户在云服务器上 `curl | bash` 安装后，`agent-bridge` 一行命令启动，支持 `--debug` 控制日志级别。

## 实现步骤

### 步骤 1：新增 `src/logger.ts` — 日志工具（~40 行）

```typescript
type Level = 'debug' | 'info' | 'warn' | 'error';

export const log = {
  debug(tag: string, ...args: unknown[]): void,
  info(tag: string, ...args: unknown[]): void,
  warn(tag: string, ...args: unknown[]): void,
  error(tag: string, ...args: unknown[]): void,
  setLevel(level: Level): void,
};
```

- 通过 `LOG_LEVEL` 环境变量控制，默认 `info`
- `--debug` 启动参数覆盖为 `debug`
- 级别优先级：debug < info < warn < error
- 输出格式：`[时间] [级别] [tag] 消息`
- 示例：`[14:30:05] [DEBUG] [Router] Delivering to CEO via openclaw`

### 步骤 2：替换现有 22 处 console 调用

按语义分配级别：

**debug**（调试细节，生产环境不输出）：
- 心跳每次发送成功 `heartbeat.ts:50`
- WebSocket 断连重连 `openclaw.ts:49`
- 新增：每个 API 请求的 method + path + 关键参数
- 新增：Router 路由决策（本机 vs 远程）
- 新增：适配器消息投递详情

**info**（关键事件，生产环境输出）：
- 启动信息 `index.ts:60-65`
- 适配器连接成功 `openclaw.ts:39`
- tmux session 创建 `claude-code.ts:22`
- Agent spawn/stop `claude-code.ts:77,85`
- 心跳注册/移除 `heartbeat.ts:66,78`

**warn**（异常但不致命）：
- 适配器连接失败 `index.ts:28,40`
- 无效心跳表达式 `heartbeat.ts:39`
- 心跳发送失败 `heartbeat.ts:52`
- 持久化读写失败 `heartbeat.ts:107,118`

**error**（严重错误）：
- Fatal 崩溃 `index.ts:71`
- WebSocket 错误 `openclaw.ts:54`

### 步骤 3：新增 `src/cli.ts` — CLI 入口（~40 行）

```
agent-bridge                     # 启动服务（LOG_LEVEL=info）
agent-bridge --debug             # 启动服务（LOG_LEVEL=debug）
agent-bridge --port 9200         # 自定义端口
agent-bridge --config ./my.json  # 自定义配置路径
```

- 用 `process.argv` 手动解析（参数少，不引入 commander/yargs）
- 解析后设置环境变量，然后调用现有 `main()`
- 文件顶部加 `#!/usr/bin/env node` shebang

### 步骤 4：修改 `src/config.ts` — 自动生成默认配置（+10 行）

- `loadConfig()` 中：如果 `bridge.json` 不存在但 `bridge.example.json` 存在，自动复制
- 复制后输出 `log.info` 提示用户
- 同理处理 `cluster.json`

### 步骤 5：修改 `package.json` — 添加 bin 和 start

```json
{
  "bin": { "agent-bridge": "dist/cli.js" },
  "scripts": {
    "start": "node dist/index.js",
    ...现有脚本保留...
  }
}
```

### 步骤 6：新增 `scripts/install.sh` — 一键安装脚本（~50 行）

```bash
curl -fsSL https://raw.githubusercontent.com/你的仓库/main/scripts/install.sh | bash
```

脚本逻辑：
1. 检查 Node.js >= 18（未安装则提示）
2. Clone 仓库到 `~/.agent-bridge`
3. `npm install && npm run build`
4. 创建符号链接 `/usr/local/bin/agent-bridge` → `~/.agent-bridge/dist/cli.js`
5. 输出成功信息和使用说明

### 步骤 7：修改 `src/index.ts` — 适配 CLI

- `main()` 改为导出函数（供 cli.ts 调用）
- 启动日志改用 logger

### 步骤 8：更新 `.env.example`

- 添加 `LOG_LEVEL=info`

## 涉及文件清单

| 操作 | 文件 |
|------|------|
| 新增 | `src/logger.ts` |
| 新增 | `src/cli.ts` |
| 新增 | `scripts/install.sh` |
| 修改 | `src/index.ts` — 导出 main + 用 logger |
| 修改 | `src/config.ts` — 自动复制 example 配置 |
| 修改 | `src/heartbeat.ts` — 用 logger |
| 修改 | `src/adapters/openclaw.ts` — 用 logger |
| 修改 | `src/adapters/claude-code.ts` — 用 logger |
| 修改 | `src/router.ts` — 加 debug 日志 |
| 修改 | `src/api/info.ts` — 加 debug 请求日志 |
| 修改 | `src/api/agents.ts` — 加 debug 请求日志 |
| 修改 | `src/api/locate.ts` — 加 debug 请求日志 |
| 修改 | `src/api/message.ts` — 加 debug 请求日志 |
| 修改 | `src/api/spawn.ts` — 加 debug 请求日志 |
| 修改 | `src/api/stop.ts` — 加 debug 请求日志 |
| 修改 | `package.json` — bin + start |
| 修改 | `.env.example` — LOG_LEVEL |

## 约束

- 不引入第三方日志库（winston/pino）— 项目太小
- 不引入 CLI 框架（commander/yargs）— 参数太少
- 不加日志文件输出 — stdout 够用
- 不加交互式 wizard — 配置项少，默认值够用
- 不加 systemd 服务 — 后续需要时再加

## 验证方式

1. `npm test` — 所有现有 46 个测试通过
2. `npm run build` — TypeScript 编译零错误
3. 本地验证 CLI：`node dist/cli.js --debug` 启动，观察 debug 日志输出
4. 验证自动配置：删除 bridge.json → 启动 → 自动从 example 复制
5. 验证安装脚本：在干净环境运行 `bash scripts/install.sh`
