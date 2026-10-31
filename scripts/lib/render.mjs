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
    contextMode: '- Use Context Mode tools for large outputs (logs, test runs, snapshots) instead of dumping them into context.\n',
  },
  es: {
    lang: 'Responde siempre en español.',
    serena: ', símbolos con Serena',
    contextMode: '- Usa las herramientas de Context Mode para salidas grandes (logs, tests, snapshots) en vez de volcarlas al contexto.\n',
  },
};

export function renderRules(root, { lang, tools }) {
  const file = lang === 'es' ? 'AGENTS.es.md' : 'AGENTS.md';
  const t = TEXT[lang] ?? TEXT.en;
  const header = `<!-- ${'managed by lean-agents'}: edit core/AGENTS.md upstream or add your own rules in a separate file -->\n`;
  return (
    header +
    fs
      .readFileSync(path.join(root, 'core', file), 'utf8')
      .replace('{{LANG_RULE}}', t.lang)
      .replace('{{SERENA_HINT}}', tools.includes('serena') ? t.serena : '')
      .replace('{{CONTEXT_MODE_RULE}}', tools.includes('context-mode') ? t.contextMode : '')
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
