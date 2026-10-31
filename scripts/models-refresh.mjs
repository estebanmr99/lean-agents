#!/usr/bin/env node
// Compares the model IDs in profiles/ with the public models.dev catalog.
// Prints a Markdown report. --check exits 1 when a profile uses an ID the catalog lacks.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CATALOG = 'https://models.dev/api.json';

// profiles: [{ name, tiers }]. IDs without a provider prefix are aliases and are skipped.
export function diffModels(profiles, catalog) {
  const missing = [];
  const newer = [];
  for (const { name, tiers } of profiles) {
    for (const { model } of Object.values(tiers)) {
      if (!model.includes('/')) continue;
      const [provider, id] = model.split(/\/(.*)/);
      const models = catalog[provider]?.models ?? {};
      const current = models[id];
      if (!current) {
        missing.push({ profile: name, model });
        continue;
      }
      const latest = Object.values(models)
        .filter((m) => m.family === current.family && m.release_date > current.release_date)
        .sort((a, b) => b.release_date.localeCompare(a.release_date))[0];
      if (latest) newer.push({ profile: name, model, latest: `${provider}/${latest.id}` });
    }
  }
  return { missing, newer };
}

function report({ missing, newer }) {
  const lines = ['## Model IDs not in models.dev', ''];
  lines.push(...(missing.length ? missing.map((m) => `- \`${m.profile}\`: \`${m.model}\``) : ['None.']));
  lines.push('', '## Newer models in the same family', '');
  lines.push(...(newer.length ? newer.map((m) => `- \`${m.profile}\`: \`${m.model}\`, newer: \`${m.latest}\``) : ['None.']));
  lines.push('', `Source: ${CATALOG}. Check price and training terms before changing a profile.`);
  return lines.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, 'profiles');
  const profiles = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const res = await fetch(CATALOG);
  if (!res.ok) throw new Error(`${CATALOG}: HTTP ${res.status}`);
  const diff = diffModels(profiles, await res.json());
  console.log(report(diff));
  if (process.argv.includes('--check') && diff.missing.length) process.exitCode = 1;
}
