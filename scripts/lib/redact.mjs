// Redaction of free text that may reach a public issue or a log.
import os from 'node:os';
import { PROXY_VARS, CA_VARS, SECRET_NAME } from './network.mjs';

const esc = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Home paths, the user and host names, proxy and CA values, secret env values, emails and tokens never get through.
export function redactText(text, { home, env = process.env, user = env.USER || env.USERNAME, host = os.hostname() } = {}) {
  let out = String(text);
  const named = [...PROXY_VARS, ...CA_VARS].flatMap((n) => [env[n], env[n.toLowerCase()]]).filter((v) => v && v.length > 3);
  const secrets = Object.entries(env).filter(([k, v]) => SECRET_NAME.test(k) && v && v.length >= 8).map(([, v]) => v);
  for (const v of new Set([...named, ...secrets])) out = out.replace(new RegExp(esc(v), 'g'), '<redacted>');
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]*@[^\s]*/gi, '<redacted-url>');
  for (const h of [home].flat().filter(Boolean)) out = out.replace(new RegExp(`${esc(h).replace(/\\\\|\//g, '[\\\\/]')}(?=[\\\\/]|$|[^\\w.-])`, 'gi'), '~');
  out = out
    .replace(/(\/Users\/|\/home\/|[A-Za-z]:[\\/]Users[\\/])[^\/\\\s]+/gi, '$1<user>')
    .replace(/(^|[\s"'=:(])\/root(?=[\/\s"')]|$)/g, '$1/<user>')
    .replace(/(\/private)?\/var\/folders\/[^\/\s]+\/[^\/\s]+/g, '/var/folders/<tmp>')
    .replace(/\/private\/var\/[^\/\s]+/g, '/private/var/<tmp>');
  if (user && user.length > 1) out = out.replace(new RegExp(`\\b${esc(user)}\\b`, 'g'), '<user>');
  if (host && host.length > 2) out = out.replace(new RegExp(`\\b${esc(host)}\\b`, 'gi'), '<host>');
  return out
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>')
    .replace(/\bAuthorization(["']?\s*[:=]\s*["']?)(Basic|Bearer|Token)\s+[^\s"',;]+/gi, 'Authorization$1$2 <token>')
    .replace(/\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g, '<token>')
    .replace(/\b(gh[pousr]_|github_pat_|sk-|xox[bp]-|glpat-|ya29\.|(?:sk|rk)_(?:live|test)_)[\w-]{8,}|\bnpm_[A-Za-z0-9]{8,}\b|\bhf_[A-Za-z0-9]{8,}\b|\bAKIA[0-9A-Z]{12,}|\bAIza[\w-]{20,}/g, '<token>')
    .replace(/(aws_secret_access_key["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40}/gi, '$1<token>')
    .replace(/\b(Bearer|token)\s+[\w.~+/=-]{8,}/gi, '$1 <token>')
    .replace(/\b([\w-]*(?:api[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi, '$1<redacted>');
}
