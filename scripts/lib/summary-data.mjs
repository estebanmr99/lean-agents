// Data model of the finish-step summary page (#181). Pure: the page (PR3) only renders this object.
import { redactText } from './redact.mjs';

const BAD = new Set(['error', 'missing']);

// state: state.json (or null); rows: doctor rows `{ item, status, detail }`; applied: the `printApplied` shape
// `{ ok, files, commands, errors, version }`; logins: loginRows(); updated: names the update step changed (default none).
export function buildSummary({ state = null, rows = [], applied = {}, logins = [], updated = [], home, env, lang = 'en' } = {}) {
  const t = (v) => redactText(v, { home, env });
  const list = (a) => (a ?? []).map(t);
  const problems = rows.filter((r) => BAD.has(r.status));
  return {
    lang,
    version: t(applied.version ?? state?.version ?? ''),
    ok: (applied.ok ?? true) && !problems.length,
    action: { logins: logins.map((l) => ({ tool: l.tool, command: t(l.login), state: l.state })) },
    summary: {
      installed: list([...(applied.files ?? []), ...(applied.commands ?? []).filter((c) => c.ok).map((c) => c.desc)]),
      kept: list(rows.filter((r) => r.status === 'changed').map((r) => r.item)),
      updated: list(updated),
      skipped: list(rows.filter((r) => r.status === 'skipped').map((r) => r.item)),
      errors: list(applied.errors),
      activeSetup: t(rows.find((r) => r.item === 'Active setup')?.detail ?? ''),
      doctor: {
        ok: !problems.length,
        counts: rows.reduce((n, r) => ({ ...n, [r.status]: (n[r.status] ?? 0) + 1 }), {}),
        problems: problems.map((r) => ({ item: t(r.item), status: r.status, detail: t(r.detail ?? '') })),
      },
    },
  };
}
