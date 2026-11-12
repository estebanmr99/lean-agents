// GitHub Copilot AI-credit allowance in the OpenCode TUI sidebar (lean-agents#123).
// Local only: `gh api` calls, never a model request. Dollar figure is an estimate (1 credit = $0.01).
// Rendering follows the sidebar slot pattern (createElement/setProp/insert from the host's @opentui/solid).
import { execFile } from "node:child_process";

const MIN_REFRESH_MS = 5 * 60 * 1000;
const BAR_WIDTH = 16;
const ROWS = 4;
const SEGMENTS = 3;

function readQuota() {
  return new Promise((resolve) => {
    // shell on Windows: gh may be a .cmd shim there; the arguments are fixed.
    execFile("gh", ["api", "copilot_internal/user"], { timeout: 15000, windowsHide: true, shell: process.platform === "win32" }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

const credits = (n) => Math.round(n).toLocaleString("en-US");
const dollars = (n) => `$${(n / 100).toFixed(2)}`;

function summarize(user) {
  const p = user?.quota_snapshots?.premium_interactions;
  if (!p) return null;
  if (p.unlimited) return { unlimited: true, level: "success" };
  const spent = p.entitlement - p.remaining;
  const pct = Math.floor(p.percent_remaining);
  const reset = new Date(`${user.quota_reset_date}T00:00:00Z`);
  const days = Math.max(0, Math.ceil((reset.getTime() - Date.now()) / 86400000));
  return {
    level: pct < 10 ? "error" : pct < 25 ? "warning" : "success",
    pct,
    spent,
    left: p.remaining,
    resetLabel: reset.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    days,
  };
}

function toastMessage(s) {
  if (s.unlimited) return "Unlimited premium requests";
  return `Spent ${credits(s.spent)} (${dollars(s.spent)}) · Left ${credits(s.left)} (${dollars(s.left)}) · ${s.pct}% left · resets ${s.resetLabel} (in ${s.days} days)`;
}

// Rows of [color, text] segments for the sidebar box.
function rowsFor(state, theme) {
  const s = state.summary;
  const muted = theme.textMuted;
  if (!s) return [[[muted, state.loaded ? "unavailable (gh api failed)" : "loading..."]]];
  if (s.unlimited) return [[[theme.success ?? theme.text, "Unlimited premium requests"]]];
  const color = theme[s.level] ?? theme.text;
  const filled = Math.round((s.pct / 100) * BAR_WIDTH);
  return [
    [[color, "█".repeat(filled)], [theme.borderSubtle ?? muted, "░".repeat(BAR_WIDTH - filled)], [color, `  ${s.pct}% left`]],
    [[muted, "Spent".padEnd(8)], [theme.text, credits(s.spent).padEnd(8)], [muted, dollars(s.spent)]],
    [[muted, "Left".padEnd(8)], [theme.text, credits(s.left).padEnd(8)], [muted, dollars(s.left)]],
    [[muted, "Resets".padEnd(8)], [theme.text, s.resetLabel], [muted, ` · in ${s.days} days`]],
  ];
}

// The slot renders once per mount, so later data is painted into the mounted text nodes directly.
function paint(state, mounted) {
  if (!mounted.rows) return;
  const { solid, theme } = mounted;
  const rows = rowsFor(state, theme);
  mounted.rows.forEach((row, r) => {
    const segments = rows[r] ?? [];
    solid.setProp(row.box, "visible", segments.length > 0);
    row.texts.forEach((t, i) => {
      const [fg, value] = segments[i] ?? [theme.textMuted, ""];
      solid.setProp(t, "fg", fg);
      solid.setProp(t, "content", value);
      solid.setProp(t, "visible", value !== "");
    });
  });
}

function render(solid, theme, state, mounted) {
  const box = solid.createElement("box");
  const props = { borderStyle: "rounded", borderColor: theme.borderSubtle, title: " Copilot credits ", flexDirection: "column", paddingLeft: 1, paddingRight: 1 };
  for (const [k, v] of Object.entries(props)) solid.setProp(box, k, v);
  const rows = Array.from({ length: ROWS }, () => {
    const row = solid.createElement("box");
    solid.setProp(row, "flexDirection", "row");
    const texts = Array.from({ length: SEGMENTS }, () => {
      const t = solid.createElement("text");
      solid.insert(row, t);
      return t;
    });
    solid.insert(box, row);
    return { box: row, texts };
  });
  Object.assign(mounted, { solid, theme, rows });
  paint(state, mounted);
  return box;
}

export default {
  id: "lean-copilot-usage",
  tui: async (api) => {
    const state = { summary: null, loaded: false, fetchedAt: 0 };
    const mounted = {};
    let inFlight = false;

    const refresh = async () => {
      if (inFlight) return state.summary;
      inFlight = true;
      try {
        state.summary = summarize(await readQuota());
        state.loaded = true;
        state.fetchedAt = Date.now();
        paint(state, mounted);
        api.renderer.requestRender();
      } finally {
        inFlight = false;
      }
      return state.summary;
    };

    const toast = (s) =>
      api.ui.toast(
        s
          ? { title: "Copilot credits", variant: s.level === "success" ? "info" : s.level, duration: 8000, message: toastMessage(s) }
          : { title: "Copilot credits", variant: "warning", message: "Unavailable: `gh api copilot_internal/user` failed" },
      );

    const solid = await import("@opentui/solid").catch(() => null);
    if (solid) api.slots.register({ order: 950, slots: { sidebar_content: () => render(solid, api.theme.current, state, mounted) } });

    const command = {
      title: "Copilot usage",
      value: "copilot-usage.show",
      description: "credits left",
      category: "Usage",
      slash: { name: "copilot-usage" },
      onSelect: async (dialog) => {
        dialog?.clear?.();
        toast(await refresh());
      },
    };
    // 1.x: api.command (verified on 1.19.0). 2.x removes it: api.keymap.registerLayer (VERIFY, shape not proven yet).
    const offCommand = api.command
      ? api.command.register(() => [command])
      : api.keymap?.registerLayer?.({ commands: [command], bindings: [] });
    const offIdle = api.event?.on?.("session.idle", () => {
      if (Date.now() - state.fetchedAt >= MIN_REFRESH_MS) refresh();
    });
    api.lifecycle?.onDispose?.(() => {
      offCommand?.();
      offIdle?.();
    });

    refresh().then((first) => {
      if (!solid || (first && first.level !== "success")) toast(first);
    });
  },
};
