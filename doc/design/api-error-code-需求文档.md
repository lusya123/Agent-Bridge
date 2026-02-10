# API 错误响应标准化：添加 error_code 字段

## 背景

当前所有 API 错误响应格式为 `{ "error": "人类可读消息" }`，调用方（Agent 程序）只能靠字符串匹配判断错误类型，不稳定且易碎。

## 目标

在每个错误响应中添加 `error_code` 字段（UPPER_SNAKE_CASE），让程序化处理成为可能。

**改造前：**
```json
{ "error": "Agent \"ceo\" not found" }
```

**改造后：**
```json
{ "error_code": "AGENT_NOT_FOUND", "error": "Agent \"ceo\" not found" }
```

## 变更范围

新增 1 个文件，修改 4 个源码文件 + 4 个测试文件。约 30 行新增，0 行删除。

---

## 1. 新建 `src/errors.ts` — 错误码常量

9 个错误码覆盖全部 13 个错误场景：

```typescript
export const ErrorCode = {
  MISSING_AGENT_ID:   'MISSING_AGENT_ID',
  MISSING_FIELDS:     'MISSING_FIELDS',
  NO_ADAPTER:         'NO_ADAPTER',
  ADAPTER_NO_STOP:    'ADAPTER_NO_STOP',
  AGENT_NOT_FOUND:    'AGENT_NOT_FOUND',
  MACHINE_NOT_FOUND:  'MACHINE_NOT_FOUND',
  SPAWN_FAILED:       'SPAWN_FAILED',
  STOP_FAILED:        'STOP_FAILED',
  REMOTE_UNREACHABLE: 'REMOTE_UNREACHABLE',
} as const;
```

### 错误码映射表

| error_code | HTTP Status | 触发场景 |
|---|---|---|
| `MISSING_AGENT_ID` | 400 | locate 缺少 agent_id、stop 缺少 agent_id |
| `MISSING_FIELDS` | 400 | message 缺少 agent_id 或 message、spawn 缺少 type 或 task |
| `NO_ADAPTER` | 400 | spawn 找不到对应 type 的适配器 |
| `ADAPTER_NO_STOP` | 400 | stop 时适配器不支持停止操作 |
| `AGENT_NOT_FOUND` | 404 | locate/message/stop 找不到指定 Agent |
| `MACHINE_NOT_FOUND` | 404 | spawn 找不到目标机器 |
| `SPAWN_FAILED` | 500 | 适配器创建 Agent 失败 |
| `STOP_FAILED` | 500 | 适配器停止 Agent 失败 |
| `REMOTE_UNREACHABLE` | 502 | spawn 转发时远程机器不可达 |

---

## 2. 修改 4 个 API 源码文件

每个文件加 `import { ErrorCode } from '../errors.js'`，在每个 `c.json()` 错误响应中加 `error_code` 字段。

### `src/api/locate.ts`（2 处）

| 行号 | error_code | 场景 |
|---|---|---|
| L15 | `MISSING_AGENT_ID` | 缺少 agent_id 参数 |
| L60 | `AGENT_NOT_FOUND` | Agent 未找到 |

### `src/api/message.ts`（2 处）

| 行号 | error_code | 场景 |
|---|---|---|
| L15 | `MISSING_FIELDS` | 缺少 agent_id 或 message |
| L25 | `AGENT_NOT_FOUND` | 路由找不到 Agent |

### `src/api/spawn.ts`（5 处）

| 行号 | error_code | 场景 |
|---|---|---|
| L18 | `MISSING_FIELDS` | 缺少 type 或 task |
| L27 | `MACHINE_NOT_FOUND` | 目标机器不在集群中 |
| L39 | `REMOTE_UNREACHABLE` | 远程机器不可达 |
| L46 | `NO_ADAPTER` | 无对应适配器 |
| L57 | `SPAWN_FAILED` | 适配器创建失败 |

### `src/api/stop.ts`（4 处）

| 行号 | error_code | 场景 |
|---|---|---|
| L12 | `MISSING_AGENT_ID` | 缺少 agent_id |
| L18 | `ADAPTER_NO_STOP` | 适配器不支持停止 |
| L26 | `STOP_FAILED` | 适配器停止失败 |
| L31 | `AGENT_NOT_FOUND` | Agent 未找到 |

---

## 3. 更新 4 个测试文件

在每个错误测试用例中加一行断言：

### `test/api/locate.test.ts`（+2 断言）
- 400 测试：`expect(body.error_code).toBe('MISSING_AGENT_ID')`
- 404 测试：`expect(body.error_code).toBe('AGENT_NOT_FOUND')`

### `test/api/message.test.ts`（+3 断言）
- 400 缺 agent_id：`expect(body.error_code).toBe('MISSING_FIELDS')`
- 400 缺 message：`expect(body.error_code).toBe('MISSING_FIELDS')`
- 404 未找到：`expect(body.error_code).toBe('AGENT_NOT_FOUND')`

### `test/api/spawn.test.ts`（+3 断言）
- 400 缺 type：`expect(body.error_code).toBe('MISSING_FIELDS')`
- 400 无适配器：`expect(body.error_code).toBe('NO_ADAPTER')`
- 400 缺 task：`expect(body.error_code).toBe('MISSING_FIELDS')`

### `test/api/stop.test.ts`（+2 断言）
- 400 缺 agent_id：`expect(body.error_code).toBe('MISSING_AGENT_ID')`
- 404 未找到：`expect(body.error_code).toBe('AGENT_NOT_FOUND')`

---

## 4. 不改的文件

- `src/api/info.ts` / `src/api/agents.ts` — 无错误路径
- `src/router.ts` — 抛出的 Error 由 message handler 捕获并包装
- `src/adapters/*` — 不涉及 HTTP 响应
- `src/index.ts` — 不涉及

## 5. 验证

```bash
npm test
```

预期：所有现有测试 + 新增断言全部通过（46+ tests）。

## 设计原则

- **纯增量**：只加字段，不改现有字段，不破坏向后兼容
- **不过度工程化**：不加 helper 函数、不加 i18n、不加消息模板
- **内联修改**：直接在 `c.json()` 调用中加 `error_code` 字段
