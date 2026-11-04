// Menus and progress for a real terminal, with @clack/prompts. lean.mjs keeps its readline prompter
// for every other case: clack hangs without a TTY or with a zero-width one, and Git Bash (mintty) has no raw mode.
export const canUseMenus = (input) => input.isTTY === true && typeof input.setRawMode === 'function' && process.stdout.isTTY === true && process.stdout.columns > 0;

export async function menuPrompter(input) {
  const c = await import('@clack/prompts');
  const io = { input, output: process.stdout };
  const answer = (v) => {
    if (c.isCancel(v)) { c.cancel('Cancelled.'); throw new Error('cancelled, nothing changed'); }
    return v;
  };
  c.intro('lean-agents');
  return {
    menus: true,
    // Yes/no questions keep their readline answers (y/n), so callers do not change.
    ask: async (q, def) => {
      if (def === 'y' || def === 'n') return answer(await c.confirm({ ...io, message: q, initialValue: def === 'y' })) ? 'y' : 'n';
      return String(answer(await c.text({ ...io, message: q, placeholder: def, defaultValue: def }))).trim() || def;
    },
    select: async ({ message, options, def }) => answer(await c.select({ ...io, message, options, initialValue: def })),
    multi: async ({ message, items, defaults }) => answer(await c.multiselect({ ...io, message, options: items, initialValues: defaults, required: false })),
    close() { if (input !== process.stdin) input.destroy(); },
  };
}

// Progress list and final summary. Without menus the engine prints its plain lines instead.
export async function menuProgress() {
  const c = await import('@clack/prompts');
  return {
    step: (i, n, desc) => c.log.step(`[${i}/${n}] ${desc}`),
    result: (ok, desc) => (ok ? c.log.success(desc) : c.log.error(`failed: ${desc}. Run the command above by hand, then --doctor.`)),
    summary: (title, lines, ok) => { c.note(lines.join('\n'), title); c.outro(ok ? 'Done.' : 'Finished with errors.'); },
  };
}
