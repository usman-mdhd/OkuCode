#!/usr/bin/env bash
# OkuCode model gateway (FR-45): installs LiteLLM in ~/.okucode/gateway and makes the gateway key.
# Run on the GPU server (or any computer that can reach the model server). It changes nothing outside
# ~/.okucode/gateway unless --service is given.
#
#   bash okutobus/gateway/setup.sh                         install / update, make the key once
#   bash okutobus/gateway/setup.sh --models http://host:11434/v1   model server address (default: Ollama on this computer)
#   bash okutobus/gateway/setup.sh --service               also start it now and at every boot (Linux, systemd, needs sudo)
#
# Start it by hand with: okucode gateway start   (listens on 127.0.0.1:4000; --host 0.0.0.0 to let other computers in)
set -euo pipefail

LITELLM_VERSION="1.80.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.okucode/gateway"
MODELS_URL=""
SERVICE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --models) MODELS_URL="${2:?--models needs an address}"; shift 2 ;;
    --service) SERVICE=1; shift ;;
    -h | --help) sed -n 2,10p "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

echo "OkuCode gateway setup"
PY="$(command -v python3 || true)"
[ -n "$PY" ] || fail "python3 is missing. Ubuntu: sudo apt install -y python3 python3-venv · macOS: xcode-select --install"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || fail "python 3.9 or newer is needed (found $("$PY" --version))"

mkdir -p "$DIR"
chmod 700 "$DIR"
if [ ! -x "$DIR/venv/bin/litellm" ] || ! "$DIR/venv/bin/litellm" --version 2>/dev/null | grep -q "$LITELLM_VERSION"; then
  echo "  installing LiteLLM $LITELLM_VERSION (a minute or two)..."
  "$PY" -m venv "$DIR/venv" || fail "could not make a Python venv. Ubuntu: sudo apt install -y python3-venv"
  "$DIR/venv/bin/pip" install -q --upgrade pip >/dev/null
  "$DIR/venv/bin/pip" install -q "litellm[proxy]==$LITELLM_VERSION" || fail "pip install litellm failed"
fi
ok "LiteLLM $LITELLM_VERSION"

cp "$HERE/config.yaml" "$DIR/config.yaml"
ok "settings: $DIR/config.yaml"

ENV="$DIR/gateway.env"
if [ ! -s "$ENV" ]; then
  KEY="sk-okucode-$("$PY" -c 'import secrets; print(secrets.token_urlsafe(24))')"
  (umask 077 && printf 'OKUCODE_GATEWAY_KEY=%s\nOKUCODE_MODEL_SERVER=%s\n' "$KEY" "${MODELS_URL:-http://127.0.0.1:11434/v1}" >"$ENV")
  ok "new gateway key made (kept in $ENV)"
else
  if [ -n "$MODELS_URL" ]; then
    grep -v '^OKUCODE_MODEL_SERVER=' "$ENV" >"$ENV.tmp" && printf 'OKUCODE_MODEL_SERVER=%s\n' "$MODELS_URL" >>"$ENV.tmp" && mv "$ENV.tmp" "$ENV" && chmod 600 "$ENV"
  fi
  ok "gateway key kept (in $ENV)"
fi
chmod 600 "$ENV"

if [ "$SERVICE" = 1 ]; then
  command -v systemctl >/dev/null 2>&1 || fail "--service needs systemd (Linux). Start it with: okucode gateway start"
  UNIT=/etc/systemd/system/okucode-gateway.service
  sudo tee "$UNIT" >/dev/null <<EOF
[Unit]
Description=OkuCode model gateway (LiteLLM)
After=network-online.target ollama.service

[Service]
User=$(id -un)
EnvironmentFile=$ENV
ExecStart=$DIR/venv/bin/litellm --config $DIR/config.yaml --host 127.0.0.1 --port 4000
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload && sudo systemctl enable --now okucode-gateway >/dev/null 2>&1 || fail "could not start the service (see: sudo journalctl -u okucode-gateway)"
  ok "running as the okucode-gateway service on 127.0.0.1:4000"
fi

echo ""
echo "  Next:"
[ "$SERVICE" = 1 ] || echo "    okucode gateway start            start the gateway (127.0.0.1:4000)"
echo "    okucode gateway key              show the key to give OkuCode"
echo "    okucode gateway connect http://127.0.0.1:4000 <key>   use it in OkuCode on this computer"
