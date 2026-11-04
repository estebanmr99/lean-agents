# Model profiles

Dated templates that map tiers (`fast`, `balanced`, `strong`) to concrete models for one subscription or provider. The `update-models` skill keeps your local copy current. See [docs/SPEC.md section 9](../docs/SPEC.md#9-models-that-stay-current).

## Review notes

`node scripts/models-refresh.mjs` (monthly in CI) reports a newer model of the same family unless the profile already uses it or it produces other outputs (for example images). Check price and training terms before changing a profile.

- 2026-11-03, issue #6. `opencode-go` stays on `kimi-k3` (balanced) and `kimi-k3.1-pro` (strong). K3.1 Pro costs less per token ($2 / $10 per 1M input / output against $3 / $15), and OpenCode Go says neither is used for training ([opencode.ai/docs/go](https://opencode.ai/docs/go)). It is the deeper-reasoning tier, so it is kept for `strong` and the two tiers stay different. **VERIFY:** its speed and output-token use against K3.
- 2026-11-03, issue #6. `vertex-gemini` stays on `gemini-3.8-flash`: `gemini-nano-banana-2.1` outputs images and is not a coding model ([models.dev](https://models.dev/api.json)).
