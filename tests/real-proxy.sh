#!/usr/bin/env bash
# Real install through a proxy with every other outbound connection blocked, using the
# network all-off preset. Needs Linux, Docker, sudo, Linuxbrew and opencode on PATH (CI).
# The proxy is a squid container; iptables rejects this user's traffic except to it.
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
repo="$(cd "$(dirname "$0")/.." && pwd)"

docker run -d --name lean-squid -p 3128:3128 ubuntu/squid >/dev/null
for _ in $(seq 30); do curl -s -o /dev/null -x http://127.0.0.1:3128 https://github.com && break; sleep 2; done

# Docker rewrites 127.0.0.1:3128 to the container address before the filter table sees it.
sudo iptables -A OUTPUT -m owner --uid-owner "$(id -u)" -d 127.0.0.0/8 -j ACCEPT
sudo iptables -A OUTPUT -m owner --uid-owner "$(id -u)" -d 172.16.0.0/12 -j ACCEPT
sudo iptables -A OUTPUT -m owner --uid-owner "$(id -u)" -j REJECT
if curl -s -m 10 -o /dev/null https://github.com; then echo "direct traffic is not blocked" >&2; exit 1; fi

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME HTTP_PROXY HTTPS_PROXY NO_PROXY
# Lowercase only, with credentials: the engine must share them in both cases and never print or write them.
export http_proxy=http://ci:ci-proxy-pass@127.0.0.1:3128 https_proxy=http://ci:ci-proxy-pass@127.0.0.1:3128 no_proxy=localhost,127.0.0.1
export HOMEBREW_NO_AUTO_UPDATE=1

bash "$repo/install.sh" --yes --agents opencode-v2 --tools serena,caveman --network off \
  --lang en --profile anthropic-api | tee "$HOME/install.txt"
node "$repo/scripts/lean.mjs" --doctor | tee "$HOME/doctor.txt"

grep -q 'HTTPS_PROXY=http://\*\*\*@127.0.0.1:3128' "$HOME/install.txt"
grep -q 'network env.*HTTPS_PROXY=http://\*\*\*@127.0.0.1:3128' "$HOME/doctor.txt"
if grep -rq ci-proxy-pass "$HOME/install.txt" "$HOME/doctor.txt" "$HOME/.config"; then echo "proxy password leaked" >&2; exit 1; fi
test -f "$HOME/.agents/skills/caveman/SKILL.md"
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

{ docker exec lean-squid cat /var/log/squid/access.log; docker logs lean-squid; } > "$HOME/squid.txt" 2>&1 || true
grep -Eo 'CONNECT [^ ]+' "$HOME/squid.txt" | sort -u
grep -q 'registry.npmjs.org' "$HOME/squid.txt"
grep -q 'github.com' "$HOME/squid.txt"
echo "install through the proxy: ok"
