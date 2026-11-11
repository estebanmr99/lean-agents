// Fails on a download piped straight into a shell in a workflow or composite action (#75):
// `curl ... | bash`, `wget ... | sh`, `irm ... | iex`. Download to a file, check its SHA256, then run it (scripts/ci-download.sh).
//   node scripts/lint-workflows.mjs [files...]    (default: .github/workflows and .github/actions)
import fs from 'node:fs';
import path from 'node:path';

const PIPE = /\b(curl|wget|irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^\n]*\|\s*(sudo\s+)?(bash|sh|zsh|iex|Invoke-Expression)\b/i;

export function findPipes(text) {
  return text.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => !l.trim().startsWith('#') && PIPE.test(l)).map(([n, l]) => `${n}: ${l.trim()}`);
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile() && /\.ya?ml$/.test(e.name)).map((e) => path.join(e.parentPath, e.name));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : [...listFiles('.github/workflows'), ...listFiles('.github/actions')];
  let bad = 0;
  for (const f of files) for (const hit of findPipes(fs.readFileSync(f, 'utf8'))) { console.log(`::error file=${f}::download piped into a shell, line ${hit}`); bad++; }
  console.log(bad ? `${bad} piped download(s)` : 'no piped downloads');
  process.exit(bad ? 1 : 0);
}
