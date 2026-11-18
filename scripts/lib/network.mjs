// Network choices (telemetry, auto-update, other outbound calls) and proxy handling for child commands.
export const CATEGORIES = ['telemetry', 'autoUpdate', 'outbound'];
export const preset = (value) => Object.fromEntries(CATEGORIES.map((c) => [c, value]));

export function onOff(flag, v) {
  if (v !== 'on' && v !== 'off') throw new Error(`${flag} takes on or off`);
  return v;
}

// Old state files and --privacy only know standard/strict.
export function fromPrivacy(privacy) {
  if (privacy == null) return null;
  if (privacy !== 'strict' && privacy !== 'standard') throw new Error('--privacy takes standard or strict');
  return preset(privacy === 'strict' ? 'off' : 'on');
}

export const privacyOf = (network) => (CATEGORIES.every((c) => network[c] === 'off') ? 'strict' : 'standard');

// Env for the commands lean-agents runs, so installers do not phone home when telemetry is off.
export function childEnv(network) {
  return network.telemetry === 'off' ? { DO_NOT_TRACK: '1', HOMEBREW_NO_ANALYTICS: '1', GH_TELEMETRY: 'false' } : {};
}

export const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'];
export const CA_VARS = ['NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_SSL_CAINFO', 'UV_SYSTEM_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE', 'PIP_CERT', 'npm_config_cafile'];

export const redactUrl = (v) => v.replace(/(^|\/\/|=)[^/\s=]*@/g, '$1***@');

// Names whose values are secrets: redactText scrubs their values, allowedEnv never passes them on.
export const SECRET_NAME = /TOKEN|SECRET|PASSW|API_?KEY|(^|_)AUTH($|_)|CREDENTIAL|PRIVATE/i;

// What a child process may inherit. Sources are in docs/compatibility.md; the rest (GH_TOKEN, API keys, ...) stays here.
const ENV_EXACT = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'USERNAME', 'SHELL', 'TERM', 'COLORTERM', 'LANG', 'TZ', 'TMPDIR', 'TMP', 'TEMP', 'CI', 'NODE_OPTIONS', 'NODE_USE_ENV_PROXY', 'OPENSSL_CONF', 'DO_NOT_TRACK', 'COPILOT_HOME', 'CLAUDE_CONFIG_DIR', 'BUN_INSTALL']);
const ENV_WINDOWS = ['SystemRoot', 'SystemDrive', 'windir', 'ComSpec', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'CommonProgramFiles', 'HOMEDRIVE', 'HOMEPATH', 'OS', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'PSModulePath', 'ALLUSERSPROFILE', 'PUBLIC', 'COMPUTERNAME'];
const ENV_PREFIX = ['LC_', 'XDG_', 'NPM_CONFIG_', 'NODE_', 'NVM_', 'FNM_', 'VOLTA_', 'HOMEBREW_', 'UV_', 'GIT_', 'BUN_', 'OPENCODE_'];

// Names that run code or carry a credential inside a prefix we otherwise pass (#163). `:` and `//` are npm per-registry keys (`//host/:_authToken`).
const ENV_DROP = /^(NODE_PATH|GIT_CONFIG.*|GIT_ASKPASS|GIT_SSH|GIT_SSH_COMMAND|GIT_PROXY_COMMAND|GIT_EXEC_PATH|GIT_EDITOR|GIT_PAGER|GIT_EXTERNAL_DIFF|NPM_CONFIG_SCRIPT_SHELL)$|:|\/\//i;
// Values that hold a credential whatever the name: `://user:pass@` or `://token@`, GitHub and npm tokens.
const SECRET_VALUE = /:\/\/[^/\s@]+@|\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{16,}|\bnpm_[A-Za-z0-9]{20,}/;

// NODE_OPTIONS passes only when every token is a CA, proxy, memory or DNS setting a corporate proxy setup needs; --require, --import and the like can run code.
const SAFE_NODE_FLAG = /^--(use-(system|openssl|bundled)-ca|use-env-proxy|max-old-space-size=\d+|dns-result-order=\w+)$/;
const SPACE_VALUE = { '--max-old-space-size': /^\d+$/, '--dns-result-order': /^\w+$/ };
function safeNodeOptions(v) {
  const t = v.trim().split(/\s+/);
  for (let i = 0; i < t.length; i++) {
    if (SAFE_NODE_FLAG.test(t[i])) continue;
    const value = SPACE_VALUE[t[i]];
    if (!value || !value.test(t[i + 1] ?? '')) return false;
    i++;
  }
  return true;
}

// One stderr line per run, names only: a dropped NODE_OPTIONS or GIT_CONFIG_* would otherwise vanish without a trace (#235).
let warnedDrop = false;
function warnDropped(names) {
  if (warnedDrop) return;
  warnedDrop = true;
  console.error(`lean-agents: not passed to child processes (unsafe or carries a credential): ${names.join(', ')}`);
}

// onDrop gets the names of variables that would have passed but were dropped; never their values.
export function allowedEnv(env = process.env, platform = process.platform, onDrop = warnDropped) {
  const exact = new Set([...ENV_EXACT, ...PROXY_VARS, ...CA_VARS, ...(platform === 'win32' ? ENV_WINDOWS : [])].map((n) => n.toUpperCase()));
  const out = {};
  const dropped = [];
  const seen = new Set(); // Windows keeps one key per name in any case; a plain object could hold both
  for (const [name, value] of Object.entries(env)) {
    const up = name.toUpperCase();
    if (value == null || seen.has(up)) continue;
    const wanted = exact.has(up) || ENV_PREFIX.some((p) => up.startsWith(p));
    // A corporate proxy URL may carry user:pass on purpose; the child needs it.
    const unsafe = (up === 'NODE_OPTIONS' && value && !safeNodeOptions(value)) || SECRET_NAME.test(name) || ENV_DROP.test(name)
      || (!exact.has(up) && SECRET_VALUE.test(PROXY_VARS.includes(up) ? value.replace(/:\/\/[^/\s@]*@/, '://') : value));
    if (unsafe) { if (wanted && !seen.has(up)) dropped.push(name); continue; }
    if (wanted) { out[name] = value; seen.add(up); }
  }
  if (dropped.length) onDrop(dropped);
  return out;
}

// Tools disagree on case (brew and git read lowercase, uv uppercase), so both cases get the value.
// Only process.env changes: proxy values are never written to disk.
export function shareProxy(env = process.env) {
  for (const name of PROXY_VARS) {
    const value = env[name] || env[name.toLowerCase()];
    if (!value) continue;
    env[name] ??= value;
    env[name.toLowerCase()] ??= value;
  }
  if ((env.HTTPS_PROXY || env.HTTP_PROXY) && env.NODE_USE_ENV_PROXY == null) env.NODE_USE_ENV_PROXY = '1';
}

// True when a proxy is configured (NO_PROXY alone is not one).
export const hasProxy = (env = process.env) => PROXY_VARS.slice(0, 3).some((n) => env[n] || env[n.toLowerCase()]);

// Values never leave this report (proxy hosts and CA paths are internal): only set / not set, plus loopback in NO_PROXY.
export function proxyReport(env = process.env) {
  const lines = [];
  for (const name of PROXY_VARS) {
    const value = env[name] || env[name.toLowerCase()];
    if (!value) continue;
    if (name !== 'NO_PROXY') { lines.push(`${name}=set`); continue; }
    const have = value.split(',').map((x) => x.trim());
    const missing = ['localhost', '127.0.0.1', '::1'].filter((h) => !have.includes(h));
    lines.push(`NO_PROXY=set (loopback ${missing.length ? `missing: ${missing.join(', ')}` : 'present'})`);
  }
  for (const name of CA_VARS) if (env[name]) lines.push(`${name}=set`);
  return lines;
}
