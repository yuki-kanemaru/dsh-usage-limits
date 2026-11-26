# dsh-usage-limits

[日本語版 README](./README.ja.md)

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin that displays **ChatGPT**, **Claude**, **Gemini (Antigravity)**, **Claude (AGY)**, and **Mistral** usage limits in the left sidebar footer (directly above **Settings**).

## Features

- **Left sidebar footer widget (`sidebar.footer.action`)**: Shows remaining or used percentages and progress bars for each enabled provider when expanded, a single-row strip of dual-arc circular gauges (`GPT`, `Gem`, `AGY`, `Mis`, etc.) when collapsed, and a compact SVG ring status icon in the 56px rail. Supports a collapse/expand toggle on both desktop (persisted) and mobile, and automatically starts collapsed on narrow/short viewports (`< 768px` width or `<= 640px` height) with bounded scrollable expansion so lower sidebar sessions remain accessible.
- **Center-split dual progress bars**: Providers with two windows display a center-divided bar showing the short-term window on the left (`5h` or `Vibe`) and the longer-term or secondary window on the right (`week` or `API`), with independent color states and reset countdown tooltips.
- **Independent `Claude (AGY)` sidebar row**: Separates Antigravity's third-party partner quota (`3p-5h` / `3p-weekly`) from the Gemini pool (`gemini-5h` / `gemini-weekly`) into its own sidebar row with an individual ON/OFF toggle.
- **Per-provider toggles**: Enable or disable ChatGPT, Claude, Gemini, `Claude (AGY)`, Mistral, and PC status independently from the detail panel (Claude defaults to OFF until enabled).
- **PC telemetry & myTOKYOGAS electricity cost**: Displays live CPU, memory, optional NVIDIA GPU (`nvidia-smi` utilization, VRAM, temperature, and live power draw in watts), OS uptime, estimated wall wattage, and estimated electricity costs (current boot / today / this month) based on Tokyo Gas Basic Plan (Dec 2026 rates) with configurable tier, renewable surcharge, fuel adjustment, set discount, and power profile.
- **Detail & settings panel (`main` / `plugins.bundle.config`)**: Inspect reset countdowns, Antigravity primary and partner pools, Mistral Vibe/API budgets and credits, local DSH token tracking, Antigravity `statusLine` hook setup, and optional Mistral Admin cookie fallback.

## Data Sources

| Provider | Source | Notes |
| --- | --- | --- |
| **ChatGPT** | `~/.codex/auth.json` (read-only) -> `chatgpt.com/backend-api/wham/usage` | Strictly read-only so it never conflicts with `dsh-chatgpt-sub` token refreshes. |
| **Claude** | `CLAUDE_CODE_OAUTH_TOKEN` or `~/.claude/.credentials.json` (read-only) -> `api.anthropic.com/api/oauth/usage` | Disabled by default. Enable it in the detail panel after `claude login`. |
| **Gemini & Claude (AGY)** | Official Antigravity CLI `statusLine` hook (`~/.dsh/dsh-usage-limits/agy-quota-cache.json`) + local DSH session tracker | Uses the official `statusLine` hook rather than direct undocumented endpoints. One-click setup in the detail panel writes safely to `~/.gemini/antigravity-cli/settings.json` without overwriting an existing custom `statusLine`. |
| **Mistral** | 1. `MISTRAL_API_KEY` -> `/v1/billing/subscription`, `/v1/billing/budget`<br>2. Optional `MISTRAL_ADMIN_COOKIE` (`admin.mistral.ai`) -> `/subscription`, `/api/billing/v2/usage`, `/api/billing/credits` | Unallocated `$0` budgets are skipped when an active budget exists. Optional cookies are stored in the DSH credentials store and never sent back to the browser. |

## Installation

### From DSH Desktop UI

1. Open **Settings -> Plugins -> Add plugin**.
2. Enter the GitHub repository URL:
   ```text
   https://github.com/yuki-kanemaru/dsh-usage-limits
   ```
3. Enable `dsh-usage-limits` and **restart DSH** (required to mount the host HTTP routes).

### From CLI

```bash
dsh plugin --profile desktop add https://github.com/yuki-kanemaru/dsh-usage-limits
```

Restart DSH after installation.

## Antigravity (`agy`) Quota Sync

1. Open the **Usage limits** detail panel in DSH and click **Enable hook** under **Antigravity statusLine hook**.
2. Launch `agy` once in a terminal, wait 3-5 seconds for the TUI status line to run, and exit with `/exit`.
3. The hook writes non-sensitive quota buckets (`gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly`) to `~/.dsh/dsh-usage-limits/agy-quota-cache.json`, which DSH picks up automatically.

## Development & Tests

```bash
npm run check
npm test
```

## Security & Privacy

- API keys, OAuth tokens, and optional Mistral Admin cookies are read only inside the DSH host process and are never returned to the browser or printed to logs.
- The Antigravity `statusLine` hook stores only quota fractions, reset timestamps, plan tier, and model display name (never tokens or email addresses).
- Plugin settings are stored in `~/.dsh/dsh-usage-limits/config.json` without any secrets.

## License

[MIT](./LICENSE)
