// Renders core/ (rules, neutral subagents) and resolves model tiers from profiles/.
import fs from 'node:fs';
import path from 'node:path';

export function loadCore(root) {
  const agentsDir = path.join(root, 'core', 'agents');
  const agents = fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseAgent(fs.readFileSync(path.join(agentsDir, f), 'utf8')));
  const mcp = JSON.parse(fs.readFileSync(path.join(root, 'core', 'mcp.json'), 'utf8')).servers;
  return { agents, mcp };
}

export function parseAgent(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('agent file needs YAML frontmatter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*?)\s*(#.*)?$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { ...meta, body: m[2].trim() };
}

const TEXT = {
  en: {
    lang: 'Always reply in English.',
    serena: ', Serena symbol tools',
    contextMode: '- Output that may pass 20 lines or that you will filter (logs, test runs, CI, API responses): use Context Mode (`ctx_batch_execute`, `ctx_execute`) and print only the answer you derive. RTK compression does not replace this.\n- Web pages: `ctx_fetch_and_index`, then `ctx_search`.\n- Short output you only read, and commands that change state (git, installs): plain shell.\n',
    playwright: '- Real browser actions (clicks, forms, screenshots): Playwright.\n',
    load: '- If one of these tools is deferred or not loaded, load it first (Claude Code: `ToolSearch`). Do not fall back to the shell for that reason.\n',
  },
  es: {
    lang: 'Responde siempre en español.',
    serena: ', símbolos con Serena',
    contextMode: '- Salidas que puedan pasar de 20 líneas o que vayas a filtrar (logs, tests, CI, respuestas de API): usa Context Mode (`ctx_batch_execute`, `ctx_execute`) e imprime solo la respuesta derivada. La compresión de RTK no reemplaza esto.\n- Páginas web: `ctx_fetch_and_index`, luego `ctx_search`.\n- Salidas cortas que solo vas a leer y comandos que cambian estado (git, instalaciones): shell normal.\n',
    playwright: '- Acciones reales en el navegador (clics, formularios, capturas): Playwright.\n',
    load: '- Si una de estas herramientas está diferida o sin cargar, cárgala primero (Claude Code: `ToolSearch`). No vuelvas al shell por esa razón.\n',
  },
};

export function renderRules(root, { lang, tools }) {
  const file = lang === 'es' ? 'AGENTS.es.md' : 'AGENTS.md';
  const t = TEXT[lang] ?? TEXT.en;
  const hasTool = (...names) => names.some((name) => tools.includes(name));
  const toolRules =
    (hasTool('context-mode') ? t.contextMode : '') +
    (hasTool('playwright') ? t.playwright : '') +
    (hasTool('context-mode', 'playwright', 'serena') ? t.load : '');
  const header = `<!-- ${'managed by lean-agents'}: edit core/AGENTS.md upstream or add your own rules in a separate file -->\n`;
  return (
    header +
    fs
      .readFileSync(path.join(root, 'core', file), 'utf8')
      .replace('{{LANG_RULE}}', t.lang)
      .replace('{{SERENA_HINT}}', tools.includes('serena') ? t.serena : '')
      .replace('{{TOOL_RULES}}', toolRules)
  );
}

export function loadProfile(root, name) {
  if (!name) return null;
  const file = path.join(root, 'profiles', `${name}.json`);
  if (!fs.existsSync(file)) {
    const known = fs.readdirSync(path.join(root, 'profiles')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    throw new Error(`unknown profile "${name}". Available: ${known.join(', ')}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Tier for an agent name, honoring per-profile overrides (e.g. review on fast for Claude).
export function tierFor(profile, agentName, defaultTier) {
  return profile?.overrides?.[agentName] ?? defaultTier;
}

export function modelFor(profile, tier) {
  return profile?.tiers?.[tier] ?? null;
}
