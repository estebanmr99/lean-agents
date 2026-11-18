// Diffs two core/pins.json documents for the release notes. Pure: no I/O, no network.

const MARKS = { added: 'new', removed: 'removed' };

// Rows for every pin whose version changed, appeared or disappeared, sorted by name. `prev` may be null (no earlier release).
export function diffPins(prev, next) {
  if (!prev?.pins) return [];
  const a = prev.pins;
  const b = next.pins ?? {};
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((name) => {
    const was = a[name];
    const now = b[name];
    if (was && now && was.version === now.version) return [];
    const p = now ?? was;
    return [{
      name,
      from: was?.version ?? null,
      to: now?.version ?? null,
      kind: p.kind,
      change: !was ? 'added' : !now ? 'removed' : 'bumped',
      held: Boolean(p.hold),
      ciOnly: Boolean(p.ciOnly),
    }];
  });
}

// Markdown table, or '' when nothing changed.
export function toolVersionsTable(rows) {
  if (!rows.length) return '';
  const note = (r) => [MARKS[r.change], r.held && 'held', r.ciOnly && 'CI only'].filter(Boolean).join(', ');
  const lines = rows.map((r) => `| ${r.name} | ${r.from ?? '-'} | ${r.to ?? '-'} | ${note(r)} |`);
  return ['| Tool | From | To | Note |', '| --- | --- | --- | --- |', ...lines].join('\n');
}
