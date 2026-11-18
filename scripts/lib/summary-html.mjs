// The finish-step summary page (#181): one self-contained HTML file, inline CSS and JS, no network and no external reference.
// Pure: renders the buildSummary() model; lean.mjs writes it as an owned file and asks before opening it.
import { redactText } from './redact.mjs';
import { verifyPrompt } from './verify-prompt.mjs';
import { feedbackAllowed } from './feedback.mjs';

const MAX_ITEMS = 5;
const RUN = 'npx -y lean-agents@latest';
const ISSUE_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/;

const TEXT = {
  en: {
    title: 'lean-agents install',
    action: 'Action needed',
    login: 'Log in to each tool:',
    state: { ok: 'done', needed: 'needed', unknown: 'not checked' },
    fileOn: 'Then paste this prompt into your agent. It checks the install, fixes what fits the plan after your yes, and files an issue only after your yes.',
    fileOff: 'Then paste this prompt into your agent. It checks the install and fixes what fits the plan after your yes. Nothing is filed.',
    copy: 'Copy prompt', copied: 'Copied', show: 'Show prompt',
    summary: 'Summary',
    installed: (n) => `Installed: ${n} items`,
    kept: 'Kept', updated: 'Updated', skipped: 'Skipped', errors: 'Errors', filed: 'Filed issues', none: 'none',
    more: (n) => `+${n} more`,
    doctorOk: 'Doctor: all checks ok',
    doctorBad: (n) => `Doctor: ${n} to fix`,
    next: 'Next steps',
    steps: ['Restart your agents.', 'Log in to each tool above.', 'Paste the prompt.'],
    how: 'How to use',
    howIntro: `Your agent now has shared rules, cheap subagents and your tools. Run with \`${RUN}\`:`,
    cmds: [['--doctor', 'check the install'], ['--summary', 'rebuild this page'], ['--update', 'update pinned tools'], ['--uninstall', 'undo everything']],
    updates: 'Updates',
    updatesText: 'Auto-update is off for every pinned tool, so versions stay the ones CI tested. A daily CI run checks newer versions and each release lists the changes. Update when you want with `--update`.',
  },
  es: {
    title: 'Instalación de lean-agents',
    action: 'Acción necesaria',
    login: 'Inicia sesión en cada herramienta:',
    state: { ok: 'hecho', needed: 'falta', unknown: 'sin comprobar' },
    fileOn: 'Luego pega este prompt en tu agente. Revisa la instalación, arregla lo que cabe en el plan si dices sí, y crea un issue solo si dices sí.',
    fileOff: 'Luego pega este prompt en tu agente. Revisa la instalación y arregla lo que cabe en el plan si dices sí. No crea nada.',
    copy: 'Copiar prompt', copied: 'Copiado', show: 'Ver prompt',
    summary: 'Resumen',
    installed: (n) => `Instalado: ${n} elementos`,
    kept: 'Conservado', updated: 'Actualizado', skipped: 'Omitido', errors: 'Errores', filed: 'Issues creados', none: 'nada',
    more: (n) => `+${n} más`,
    doctorOk: 'Doctor: todo ok',
    doctorBad: (n) => `Doctor: ${n} por arreglar`,
    next: 'Próximos pasos',
    steps: ['Reinicia tus agentes.', 'Inicia sesión en cada herramienta.', 'Pega el prompt.'],
    how: 'Cómo usarlo',
    howIntro: `Tu agente ya tiene reglas compartidas, subagentes baratos y tus herramientas. Ejecuta con \`${RUN}\`:`,
    cmds: [['--doctor', 'revisa la instalación'], ['--summary', 'rehace esta página'], ['--update', 'actualiza lo fijado'], ['--uninstall', 'deshace todo']],
    updates: 'Actualizaciones',
    updatesText: 'La actualización automática está apagada en cada herramienta fijada, así las versiones son las que probó CI. Un CI diario revisa versiones nuevas y cada release lista los cambios. Actualiza cuando quieras con `--update`.',
  },
};

const CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1a1a1a;--muted:#555;--line:#c9c9c9;--code:#f1f1f1;--red-bg:#fdecea;--red-line:#b3261e;--red-fg:#7a1510;--btn:#0b57d0;--btn-fg:#fff}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--muted:#b0b0b0;--line:#444;--code:#262626;--red-bg:#3a1512;--red-line:#f2b8b5;--red-fg:#ffdad6;--btn:#a8c7fa;--btn-fg:#062e6f}}
body{margin:0;padding:1rem;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:46rem;margin:0 auto}
h1{font-size:1.4rem}h2{font-size:1.15rem;margin:0 0 .5rem}
section{border:1px solid var(--line);border-radius:8px;padding:.75rem 1rem;margin:1rem 0}
section.action{background:var(--red-bg);border:2px solid var(--red-line);color:var(--red-fg)}
code,pre{background:var(--code);color:var(--fg);border-radius:4px;font:.9em ui-monospace,monospace}
code{padding:.1em .3em}pre{padding:.75rem;overflow-x:auto;white-space:pre-wrap}
ul{padding-left:1.25rem;margin:.25rem 0}
button{min-height:2.75rem;padding:0 1rem;border:0;border-radius:6px;background:var(--btn);color:var(--btn-fg);font:inherit;cursor:pointer}
button:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid var(--fg);outline-offset:2px}
.state{font-weight:600}`;

// The copy button: the Clipboard API on a secure page, a selection copy on file://.
const JS = `(function(){var b=document.getElementById('copy'),p=document.getElementById('prompt'),s=document.getElementById('copied');
if(!b||!p)return;b.addEventListener('click',function(){var t=p.textContent;
function done(){s.textContent=b.getAttribute('data-done')}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(done,fallback)}else{fallback()}
function fallback(){var r=document.createRange();r.selectNodeContents(p);var g=window.getSelection();g.removeAllRanges();g.addRange(r);try{if(document.execCommand('copy'))done()}catch(e){}}})})();`;

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// `code` spans in the strings above become <code>.
const md = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');

// `model` is buildSummary()'s result; `filed` is state.filedIssues; `network` decides whether the prompt may file issues.
export function renderSummary({ model, filed = [], network, home, env } = {}) {
  const lang = TEXT[model.lang] ? model.lang : 'en';
  const x = TEXT[lang];
  const t = (v) => esc(redactText(v, { home, env }));
  const allowFile = feedbackAllowed(network);
  const prompt = redactText(verifyPrompt({ lang, network }), { home, env });
  const { summary } = model;
  const list = (items) => {
    if (!items.length) return x.none;
    const shown = items.slice(0, MAX_ITEMS).map(t).join(', ');
    return items.length > MAX_ITEMS ? `${shown} ${x.more(items.length - MAX_ITEMS)}` : shown;
  };
  const rows = [`<li>${esc(x.installed(summary.installed.length))}</li>`];
  for (const k of ['kept', 'updated', 'skipped']) rows.push(`<li>${esc(x[k])}: ${list(summary[k])}</li>`);
  if (summary.errors.length) rows.push(`<li>${esc(x.errors)}: ${list(summary.errors)}</li>`);
  const d = summary.doctor;
  rows.push(`<li>${esc(d.ok ? x.doctorOk : x.doctorBad(d.problems.length))}</li>`);
  for (const p of d.problems.slice(0, MAX_ITEMS)) rows.push(`<li><code>${t(p.item)}</code>: ${t(p.status)} ${t(p.detail)}</li>`);
  const links = filed.filter((f) => ISSUE_URL.test(f.url));
  if (links.length) rows.push(`<li>${esc(x.filed)}: ${links.map((f) => `<a href="${esc(f.url)}">${t(f.item)}</a>`).join(', ')}</li>`);
  const logins = model.action.logins
    .map((l) => `<li><code>${t(l.command)}</code> (${t(l.tool)}) <span class="state">${esc(x.state[l.state] ?? x.state.unknown)}</span></li>`)
    .join('');
  return `<!doctype html>
<!-- managed by lean-agents: rewritten by --summary, removed by --uninstall -->
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(x.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${esc(x.title)} ${t(model.version)}</h1>
<section class="action" aria-labelledby="h-action">
<h2 id="h-action">${esc(x.action)}</h2>
<p>${esc(x.login)}</p>
<ul>${logins}</ul>
<p>${esc(allowFile ? x.fileOn : x.fileOff)}</p>
<p><button type="button" id="copy" data-done="${esc(x.copied)}">${esc(x.copy)}</button> <span id="copied" role="status" aria-live="polite"></span></p>
<details><summary>${esc(x.show)}</summary><pre id="prompt">${esc(prompt)}</pre></details>
</section>
<section aria-labelledby="h-summary">
<h2 id="h-summary">${esc(x.summary)}</h2>
<ul>${rows.join('')}</ul>
</section>
<section aria-labelledby="h-next">
<h2 id="h-next">${esc(x.next)}</h2>
<ol>${x.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
</section>
<section aria-labelledby="h-how">
<h2 id="h-how">${esc(x.how)}</h2>
<p>${md(x.howIntro)}</p>
<ul>${x.cmds.map(([c, d]) => `<li><code>${esc(c)}</code> ${esc(d)}</li>`).join('')}</ul>
</section>
<section aria-labelledby="h-updates">
<h2 id="h-updates">${esc(x.updates)}</h2>
<p>${md(x.updatesText)}</p>
</section>
</main>
<script>${JS}</script>
</body>
</html>
`;
}

// Opening the page is a question, never a default: not under CI, --no-open, --yes or --json, and not without a terminal.
export const canOffer = ({ noOpen, yes, json, env = process.env, tty }) => !noOpen && !yes && !json && !env.CI && !!tty;

export function openArgv(platform, file) {
  if (platform === 'darwin') return ['open', file];
  if (platform === 'win32') return ['cmd', '/c', 'start', '', file];
  return ['xdg-open', file];
}
