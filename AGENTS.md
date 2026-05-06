# Agent Instructions

This repo is a local-first Facebook Marketplace listing workstation. Use it to ingest item data, review editable listings, and automate Facebook draft/posting flows through Playwright in the user's already logged-in browser profile.

## Non-Negotiables

- Do not store or request Facebook credentials.
- Do not commit real photos, browser profiles, SQLite project databases, posting screenshots, inventory exports, or user item details.
- Keep public descriptions buyer-facing. Never post internal notes, pipeline notes, owner-facing reminders, or phrases listed in Settings as forbidden public phrases.
- Preserve removed photos, cover-photo choices, listing edits, approvals, and posting results in project state.
- Default to draft-and-confirm. Auto-publish is allowed only when the user explicitly asks for it and both the app setting and worker flag are enabled.

## Core Commands

```bash
npm install
npm --prefix app/frontend install
npm run frontend:build
npm run app
```

The local app is served at `http://127.0.0.1:8766/`.

Run tests before committing:

```bash
npm test
node --check scripts/facebook_marketplace_worker.js
```

## Posting With Playwright

Use the reusable worker instead of ad hoc browser scripts whenever possible:

```bash
npm run post:drafts
node scripts/facebook_marketplace_worker.js --ids example-001
node scripts/facebook_marketplace_worker.js --prefix batch-2026-01
```

To auto-publish approved listings, all of these must be true:

1. The user explicitly asked for automatic publishing.
2. The listing is approved and valid in the app.
3. Settings has `auto_publish=true`.
4. The worker is run with `--publish-approved`.

```bash
node scripts/facebook_marketplace_worker.js --ids example-001 --publish-approved
```

Always restore `auto_publish=false` after an auto-publish run unless the user asks to leave it enabled.

Detailed instructions live in `docs/playwright-posting.md`.

## Safe Git Scope

Safe to commit:

- Source code under `marketplace_bulk/`, `app/frontend/`, `scripts/facebook_marketplace_worker.js`, `tests/`, `docs/`, and generic `examples/`.
- Generic templates and docs that contain no real listing data.

Do not commit:

- `projects/`, `outputs/`, `data/`, `.playwright-mcp/`, browser profiles, photos, screenshots, spreadsheets, or one-off private inventory scripts.
