#!/usr/bin/env bash
# setup-heartbeat.sh — 在生产环境安装系统 cron 心跳
# 用法: sudo bash scripts/setup-heartbeat.sh [--port 9100] [--agent CEO]

set -euo pipefail

PORT="${PORT:-9100}"
AGENT="${AGENT:-CEO}"
CRON_FILE="/etc/cron.d/agent-heartbeat"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --agent) AGENT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

BRIDGE="http://localhost:${PORT}"

cat > "${CRON_FILE}" << EOF
# Agent Bridge heartbeat — auto-generated
# Do not edit manually; re-run setup-heartbeat.sh to update.
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin

# 每小时 — 检查紧急事项
0 * * * * root curl -sf -X POST ${BRIDGE}/message -H 'Content-Type: application/json' -d '{"agent_id":"${AGENT}","from":"system","message":"[小心跳] 检查是否有需要处理的事项。"}' >/dev/null 2>&1

# 每天早上 9 点 — 规划今天的工作
0 9 * * * root curl -sf -X POST ${BRIDGE}/message -H 'Content-Type: application/json' -d '{"agent_id":"${AGENT}","from":"system","message":"[日心跳] 规划今天的内容生产和实验计划。"}' >/dev/null 2>&1

# 每周一早上 9 点 — 复盘和策略调整
0 9 * * 1 root curl -sf -X POST ${BRIDGE}/message -H 'Content-Type: application/json' -d '{"agent_id":"${AGENT}","from":"system","message":"[周心跳] 复盘上周数据，调整策略，更新方法论。"}' >/dev/null 2>&1
EOF

chmod 644 "${CRON_FILE}"
echo "[setup-heartbeat] Installed cron heartbeat to ${CRON_FILE}"
echo "[setup-heartbeat] Agent: ${AGENT}, Bridge: ${BRIDGE}"
echo "[setup-heartbeat] Schedules: hourly + daily@9am + weekly@Monday-9am"
