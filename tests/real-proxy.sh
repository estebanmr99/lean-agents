#!/usr/bin/env bash
# Real install through a proxy with every other outbound connection blocked, using the
# network all-off preset. Needs Linux, Docker, sudo, Linuxbrew, opencode, agy and gh with
# GH_TOKEN (CI).
# The proxy is a squid container; iptables rejects this user's traffic except to it.
set -euo pipefail

for bin in opencode gh agy; do command -v "$bin" >/dev/null || { echo "$bin not on PATH" >&2; exit 1; }; done
repo="$(cd "$(dirname "$0")/.." && pwd)"

docker run -d --name lean-squid -p 3128:3128 ubuntu/squid >/dev/null
for _ in $(seq 30); do curl -s -o /dev/null -x http://127.0.0.1:3128 https://github.com && break; sleep 2; done

# Docker rewrites 127.0.0.1:3128 to the container address before the filter table sees it.
uid="$(id -u)"
unblock() {
  sudo iptables -D OUTPUT -m owner --uid-owner "$uid" -j REJECT || true
  sudo iptables -D OUTPUT -m owner --uid-owner "$uid" -d 172.16.0.0/12 -j ACCEPT || true
  sudo iptables -D OUTPUT -m owner --uid-owner "$uid" -d 127.0.0.0/8 -j ACCEPT || true
}
trap unblock EXIT
sudo iptables -A OUTPUT -m owner --uid-owner "$uid" -d 127.0.0.0/8 -j ACCEPT
sudo iptables -A OUTPUT -m owner --uid-owner "$uid" -d 172.16.0.0/12 -j ACCEPT
sudo iptables -A OUTPUT -m owner --uid-owner "$uid" -j REJECT
if curl -s -m 10 -o /dev/null https://github.com; then echo "direct traffic is not blocked" >&2; exit 1; fi

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME HTTP_PROXY HTTPS_PROXY NO_PROXY
# Lowercase only, with credentials: the engine must share them in both cases and never print or write them.
# Random per run, so no fixed credential lives in the repo; squid ignores it.
pw="$(openssl rand -hex 12)"
export http_proxy="http://ci:$pw@127.0.0.1:3128" https_proxy="http://ci:$pw@127.0.0.1:3128" no_proxy=localhost,127.0.0.1
export HOMEBREW_NO_AUTO_UPDATE=1

bash "$repo/install.sh" --yes --agents opencode-v2 --tools serena,caveman --network off \
  --lang en --profile anthropic-api | tee "$HOME/install.txt"
node "$repo/scripts/lean.mjs" --doctor | tee "$HOME/doctor.txt"

grep -q 'HTTPS_PROXY=http://\*\*\*@127.0.0.1:3128' "$HOME/install.txt"
grep -q 'network env.*HTTPS_PROXY=http://\*\*\*@127.0.0.1:3128' "$HOME/doctor.txt"
if grep -rq "$pw" "$HOME/install.txt" "$HOME/doctor.txt" "$HOME/.config"; then echo "proxy password leaked" >&2; exit 1; fi
test -f "$HOME/.agents/skills/caveman/SKILL.md"
# Bun came through the proxy, the all-off preset wrote its telemetry block, and Bun's own fetch honors the proxy.
test -x "$HOME/.bun/bin/bun"
grep -q '^telemetry = false' "$HOME/.bunfig.toml"
HTTPS_PROXY="$https_proxy" "$HOME/.bun/bin/bun" -e 'fetch("https://github.com").then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'
command -v rtk >/dev/null
command -v uvx >/dev/null

# Only lowercase is exported here, and OpenCode documents uppercase.
HTTPS_PROXY="$https_proxy" opencode debug config > "$HOME/resolved.txt"
node --input-type=module - "$HOME/resolved.txt" "$repo" "$HOME/.config/lean-agents/state.json" <<'JS'
import fs from 'node:fs';
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
const cfg = resolvedOpenCodeConfig(fs.readFileSync(process.argv[2], 'utf8'));
const state = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
const checks = {
  'share disabled': cfg.share === 'disabled',
  'update disabled': cfg.update === 'disable',
  'opencode provider denied': (cfg.policies ?? []).some((p) => p.resource === 'opencode' && p.effect === 'deny'),
  'state: all off': JSON.stringify(state.options.network) === JSON.stringify({ telemetry: 'off', autoUpdate: 'off', outbound: 'off' }),
};
for (const [k, ok] of Object.entries(checks)) console.log(`${ok ? 'ok  ' : 'FAIL'} ${k}`);
if (Object.values(checks).includes(false)) process.exit(1);
JS

# Checks for docs/compatibility.md: gh and agy behind a proxy, and gh with a corporate CA.
gh api /zen >/dev/null
ca_dir="$(mktemp -d)"
: > "$ca_dir/empty.pem"
if SSL_CERT_FILE="$ca_dir/empty.pem" SSL_CERT_DIR="$ca_dir" gh api /zen >/dev/null 2>"$HOME/gh-ca.txt"; then
  echo "gh ignored SSL_CERT_FILE" >&2; exit 1
fi
grep -i certificate "$HOME/gh-ca.txt"
agy --version
HTTPS_PROXY="$https_proxy" HTTP_PROXY="$http_proxy" agy plugin install https://github.com/mksglu/context-mode/tree/main/configs/antigravity-cli
echo "gh and agy through the proxy: ok"

{ docker exec lean-squid cat /var/log/squid/access.log; docker logs lean-squid; } > "$HOME/squid.txt" 2>&1 || true
grep -Eo 'CONNECT [^ ]+' "$HOME/squid.txt" | sort -u
grep -q 'registry.npmjs.org' "$HOME/squid.txt"
grep -q 'github.com' "$HOME/squid.txt"
grep -q 'bun.com' "$HOME/squid.txt"
echo "install through the proxy: ok"
