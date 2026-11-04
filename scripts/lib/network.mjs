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

const PROXY_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY'];
const CA_VARS = ['NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'GIT_SSL_CAINFO', 'UV_SYSTEM_CERTS', 'REQUESTS_CA_BUNDLE', 'npm_config_cafile'];

export const redactUrl = (v) => v.replace(/\/\/[^/@\s]+@/g, '//***@');

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

export function proxyReport(env = process.env) {
  const lines = [];
  for (const name of PROXY_VARS) {
    const value = env[name] || env[name.toLowerCase()];
    if (value) lines.push(`${name}=${redactUrl(value)}`);
  }
  for (const name of CA_VARS) if (env[name]) lines.push(`${name}=${env[name]}`);
  return lines;
}
