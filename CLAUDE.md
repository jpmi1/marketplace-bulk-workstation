# Claude Code Instructions

Follow `AGENTS.md` first. This file exists so Claude Code can discover the same repo rules that Codex uses.

The shortest safe workflow is:

1. Start the app with `npm run app`.
2. Use `Intake` at `http://127.0.0.1:8766/` to upload photos or import outputs.
3. Use `Path to 1 BTC` as an optional side tracker for editable BTC goals, sale proceeds, BTC buys, and Google Sheets-ready exports.
4. Use `Agent Setup` to copy selected-listing prompts into Claude Code.
5. Review listings and approve only clean buyer-facing descriptions with usable photos.
6. Use draft mode only as a smoke test; Facebook drafts are not a reliable final handoff surface.
7. Use `node scripts/facebook_marketplace_worker.js --ids <listing-id> --live` to post approved listings live only after the user explicitly asks for live posting and Settings has `auto_publish=true`.

For price comp research, product facts, and additional image discovery, follow `docs/research-pipeline.md`. Respect `comp_research_enabled` and `image_research_enabled` before searching. Save sources and confidence into the app, not into committed local files.

For setup, GitHub connection, and handoff prompts, follow `docs/agent-onboarding.md`.

Do not present the Path to 1 BTC tracker as financial advice or Kraken referral bonuses as guaranteed. The tracker is manual and on-device by default; Google Sheets support is export plus stored Sheet URL.

Never commit private listing data, photos, local project databases, browser profiles, posting screenshots, or user-specific exports.
