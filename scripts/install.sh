#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${HOME}/.agent-bridge"
REPO_URL="https://github.com/user/agent-bridge.git"

echo "=== Agent Bridge Installer ==="

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "Error: Node.js is not installed. Please install Node.js >= 18."
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js >= 18 required (found v$(node -v))"
  exit 1
fi

echo "[1/4] Node.js $(node -v) OK"

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "[2/4] Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  echo "[2/4] Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Build
echo "[3/4] Installing dependencies and building..."
npm install --production=false
npm run build

# Symlink
echo "[4/4] Creating symlink..."
chmod +x "$INSTALL_DIR/dist/cli.js"
if [ -w /usr/local/bin ]; then
  ln -sf "$INSTALL_DIR/dist/cli.js" /usr/local/bin/agent-bridge
else
  sudo ln -sf "$INSTALL_DIR/dist/cli.js" /usr/local/bin/agent-bridge
fi

echo ""
echo "=== Installation complete ==="
echo "Usage:"
echo "  agent-bridge              # start (LOG_LEVEL=info)"
echo "  agent-bridge --debug      # start with debug logs"
echo "  agent-bridge --port 9200  # custom port"
