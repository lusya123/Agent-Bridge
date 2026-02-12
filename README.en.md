# Agent Bridge

**[中文](README.md) | English**

A distributed agent communication platform — enabling cross-machine collaboration between agents from different frameworks.

## Why Agent Bridge?

When you have multiple machines running different agent frameworks (OpenClaw, Claude Code, etc.) that need to communicate, Agent Bridge acts as the "post office":

- **Cross-machine**: Agent A on cloud-a can talk to Agent B on cloud-b
- **Cross-framework**: OpenClaw agents and Claude Code agents communicate through a unified API
- **Weak-model friendly**: Agents only need `curl` to participate in collaboration

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Machine A (cloud-a)               │
│                                                      │
│  ┌──────────┐    ┌───────────────────────────────┐  │
│  │ OpenClaw │◄──►│         Agent Bridge           │  │
│  │ Gateway  │ ws │  :9100                         │  │
│  │  :18789  │    │  ┌─────┐ ┌──────┐ ┌────────┐  │  │
│  └──────────┘    │  │ API │→│Router│→│Adapters│  │  │
│                  │  └─────┘ └──────┘ └────────┘  │  │
│  ┌──────────┐    │                                │  │
│  │  tmux    │◄──►│  Heartbeat Manager             │  │
│  │ sessions │    └──────────────┬────────────────┘  │
│  └──────────┘                  │ HTTP forward       │
└────────────────────────────────┼─────────────────────┘
                                 │ Tailscale VPN
┌────────────────────────────────┼─────────────────────┐
│                Machine B (cloud-b)                    │
│                                │                      │
│                  ┌─────────────▼─────────────────┐   │
│                  │        Agent Bridge            │   │
│                  │        :9100                   │   │
│                  └───────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

**Three-layer architecture:**

| Layer | Responsibility | Implementation |
|-------|---------------|----------------|
| HTTP API | 10 endpoints, unified entry | Hono |
| Router | Local delivery / remote HTTP forwarding | Router |
| Adapter | Framework integration | OpenClaw (WebSocket) / Claude Code (tmux) |

## Documentation

Complete documentation is available in the [doc/](doc/) directory:

- **User Docs**: [Configuration](doc/configuration.md), [Deployment](doc/deployment.md), [API Reference](doc/api-reference.md), [Troubleshooting](doc/troubleshooting.md)
- **Design Docs**: [Complete Technical Proposal](doc/design/Agent-Bridge-完整技术方案.md), [OpenClaw Gateway Protocol](doc/design/openclaw-gateway.md), [Cluster Networking](doc/design/cluster-networking.md)
- **Project Management**: [Open Issues](doc/open-issues.md), [Changelog](CHANGELOG.md)

See [doc/README.md](doc/README.md) for the full index.

## Quick Start

### Installation

```bash
# Requires Node.js >= 18
git clone https://github.com/user/agent-bridge.git
cd agent-bridge
npm install
npm run build
```

Or one-click install:

```bash
curl -sSL https://your-repo/scripts/install.sh | bash
```

### Configuration

On first startup, configuration files are automatically copied from `config/*.example.json`:

```bash
# Local configuration
vim config/bridge.json
```

**bridge.json** — Local settings:

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
    "openclaw": { "gateway": "ws://127.0.0.1:18789" },
    "claude_code": { "tmux_session": "agents" }
  }
}
```

### Startup

```bash
agent-bridge              # Default startup
agent-bridge --debug      # Enable debug logging
agent-bridge --port 9200  # Custom port
agent-bridge --config ./my-bridge.json  # Custom config path
```

## API

All endpoints listen on `http://<machine>:9100`.

Authentication required: `Authorization: Bearer <secret>` (except `/health`)

### GET /info

Returns machine information.

```bash
curl -H "Authorization: Bearer <secret>" http://localhost:9100/info
```

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
    { "id": "ceo", "type": "openclaw", "status": "idle", "description": "CEO Agent" }
  ]
}
```

### GET /agents

Lists all running agents on this machine. Use `?scope=cluster` for cluster-wide view.

```bash
curl -H "Authorization: Bearer <secret>" http://localhost:9100/agents
curl -H "Authorization: Bearer <secret>" http://localhost:9100/agents?scope=cluster
```

```json
[
  { "id": "ceo", "type": "openclaw", "status": "running", "persistent": true, "machine": "cloud-a" },
  { "id": "tmp-cc-123", "type": "claude-code", "status": "running", "persistent": false, "machine": "cloud-a" }
]
```

### GET /locate?agent_id=xxx

Locates which machine an agent is running on.

```bash
curl -H "Authorization: Bearer <secret>" http://localhost:9100/locate?agent_id=ceo
```

```json
{
  "agent_id": "ceo",
  "machine": "cloud-a",
  "bridge": "http://100.64.0.2:9100",
  "type": "openclaw"
}
```

### POST /message

Sends a message to an agent. Automatically forwards to remote machine if needed.

```bash
curl -X POST http://localhost:9100/message \
  -H 'Authorization: Bearer <secret>' \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "ceo", "from": "user", "message": "Check today'\''s tasks"}'
```

```json
{ "ok": true }
```

### POST /spawn

Creates a new agent. Supports cross-machine spawning, independent sessions, dynamic creation, and callback injection.

```bash
curl -X POST http://localhost:9100/spawn \
  -H 'Authorization: Bearer <secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "claude-code",
    "agent_id": "analyzer",
    "task": "Analyze data in /data/report.json",
    "persistent": false,
    "machine": "cloud-b"
  }'
```

```json
{ "ok": true, "agent_id": "analyzer", "machine": "cloud-b" }
```

### POST /stop

Stops an agent.

```bash
curl -X POST http://localhost:9100/stop \
  -H 'Authorization: Bearer <secret>' \
  -H 'Content-Type: application/json' \
  -d '{"agent_id": "analyzer"}'
```

```json
{ "ok": true }
```

### POST /cluster/join

Registers a Hub node to the cluster (Hub nodes only).

```bash
curl -X POST http://localhost:9100/cluster/join \
  -H 'Authorization: Bearer <secret>' \
  -H 'Content-Type: application/json' \
  -d '{"hub_url": "http://43.134.124.4:9100"}'
```

### GET /cluster/members

Lists all cluster members.

```bash
curl -H "Authorization: Bearer <secret>" http://localhost:9100/cluster/members
```

### GET /health

Health check endpoint (no authentication required).

```bash
curl http://localhost:9100/health
```

### WS /cluster/ws

WebSocket endpoint for Edge nodes to connect to Hub.

## Adapters

Bridge integrates with different agent frameworks through adapters. All adapters implement a unified interface:

```typescript
interface Adapter {
  type: string;
  connect(): Promise<void>;
  sendMessage(agentId: string, message: string): Promise<void>;
  spawnAgent(agentId: string, task: string): Promise<void>;
  stopAgent(agentId: string): Promise<void>;
  listAgents(): Promise<AgentInfo[]>;
}
```

### OpenClaw Adapter

Connects to OpenClaw Gateway via WebSocket using JSON-RPC protocol.

- Connection: `ws://127.0.0.1:18789` (configurable)
- Auto-reconnect with exponential backoff
- RPC timeout: 10 seconds

### Claude Code Adapter

Manages Claude Code process instances through tmux.

- Create agent: `tmux new-window -n <agent_id> "claude --print '<task>'"`
- Send message: `tmux send-keys -t <session>:<agent_id> '<message>' Enter`
- Stop: `tmux kill-window -t <session>:<agent_id>`
- List: Parse `tmux list-windows` output

## Message Routing

```
Receive /message request
    │
    ▼
Local adapter has this agent? ──Yes──► Direct delivery
    │
    No
    ▼
Iterate cluster machines, HTTP forward ──Success──► Return ok
    │
    All failed
    ▼
Return 404: Agent not found
```

## Cluster Networking (Phase 6)

Agent Bridge uses a token-based networking model:

- **Token format**: `<128-bit-secret>@<hub-address:port>`
- **Hub nodes** (with public IP): HTTP direct connection between Hubs
- **Edge nodes** (without public IP): WebSocket long connection to Hub
- **Token secret**: Used for API authentication + cluster membership + user isolation
- **Dynamic discovery**: Replaces static cluster.json
- **Token persistence**: Saved to `~/.agent-bridge/token`, survives restarts

See [doc/design/cluster-networking.md](doc/design/cluster-networking.md) for details.

## OpenClaw Plugin (Phase 5 + 5.5)

Bridge provides an OpenClaw plugin with 4 tools:

- `bridge_agents` — List agents (local or cluster-wide)
- `bridge_spawn` — Create new agent (supports cross-machine)
- `bridge_message` — Send message to agent
- `bridge_stop` — Stop agent

Plugin source: `src/openclaw-plugin/` (copied to `~/.openclaw/extensions/agent-bridge/` on install)

## Networking

Recommended: Use [Tailscale](https://tailscale.com/) for networking:

- All machines join the same Tailscale network
- Use 100.64.x.x fixed IPs for direct connection
- No NAT traversal or port mapping needed

## Development

```bash
npm run dev        # Development mode (tsx watch, hot reload)
npm test           # Run tests
npm run test:watch # Test watch mode
npm run build      # TypeScript compilation
```

## Project Structure

```
src/
├── index.ts          # Service entry, initialize adapters + router + cluster
├── cli.ts            # CLI entry, parse command line arguments
├── config.ts         # Configuration loading (bridge + cluster)
├── router.ts         # Message routing (local delivery / remote forward)
├── token.ts          # Token generation, parsing, persistence
├── cluster.ts        # ClusterManager (member management, Hub heartbeat)
├── cluster-ws.ts     # WebSocket relay (Hub server + Edge client)
├── detect-ip.ts      # Public IP auto-detection
├── logger.ts         # Logging system (4 levels, no external deps)
├── middleware/
│   └── auth.ts       # Bearer token authentication middleware
├── adapters/
│   ├── types.ts      # Unified adapter interface
│   ├── openclaw.ts   # OpenClaw adapter (WebSocket RPC)
│   └── claude-code.ts # Claude Code adapter (tmux)
├── api/
│   ├── info.ts       # GET  /info
│   ├── agents.ts     # GET  /agents
│   ├── locate.ts     # GET  /locate
│   ├── message.ts    # POST /message
│   ├── spawn.ts      # POST /spawn
│   ├── stop.ts       # POST /stop
│   └── cluster.ts    # POST /cluster/join, GET /cluster/members
└── openclaw-plugin/
    ├── index.ts      # Plugin entry (4 bridge tools)
    └── openclaw.plugin.json  # Plugin manifest

config/
├── bridge.example.json   # Local config template
├── bridge.cloud-a.json   # Cloud-a config template
└── bridge.cloud-b.json   # Cloud-b config template

doc/
├── README.md                              # Documentation index
├── configuration.md                       # Configuration reference
├── deployment.md                          # Deployment guide
├── api-reference.md                       # API reference
├── troubleshooting.md                     # Troubleshooting
└── design/
    ├── Agent-Bridge-完整技术方案.md        # Complete technical proposal
    ├── openclaw-gateway.md                # OpenClaw Gateway protocol
    └── cluster-networking.md              # Phase 6 cluster networking design

scripts/
└── install.sh            # One-click install script
```

## Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| Language | TypeScript | Type safety |
| HTTP | Hono | Lightweight, zero dependencies |
| WebSocket | ws | Connect to OpenClaw Gateway |
| Process Management | tmux | Manage Claude Code instances |
| Testing | vitest | Fast, native TS support |

## Design Principles

- **AI-native** — Intelligence lives in LLMs, infrastructure only delivers messages
- **No framework modification** — Integrate through external interfaces (WebSocket / tmux)
- **No over-engineering** — Solve problems with minimal code
- **Weak-model friendly** — Agents only need `curl` to communicate

## Current Status

- Phase 1 ~ 6 completed (153 unit tests, all passed)
- Phase 6 additions: Token networking, Bearer auth, ClusterManager, Hub/Edge WebSocket relay, cluster-wide agent view
- Design doc: `doc/design/cluster-networking.md`

## License

MIT
