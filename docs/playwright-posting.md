# Playwright Posting Guide

This guide is for Codex, Claude Code, and other local agents operating this repo. The goal is repeatable Facebook Marketplace posting without credential handling or private data leakage.

## Safety Model

The worker uses Playwright with a persistent local browser profile. On launch it opens Facebook and pauses before posting until the user finishes any required login in that browser window. The repo never stores credentials.

Facebook drafts are not a reliable handoff surface. Use draft mode only as a smoke test; the normal final workflow is to live-post approved listings from the worker. Final publishing requires two gates:

- Project setting: `auto_publish=true`
- CLI flag: `--live` or `--publish-approved`

If either gate is missing, the worker fills the listing and stops before Publish.

## Before Posting

1. Start the app:

```bash
npm run app
```

2. Open `http://127.0.0.1:8766/`.
3. Confirm each listing is approved and has:
   - Buyer-facing title
   - Numeric price
   - Accepted Facebook condition
   - Category
   - Public description with no internal notes
   - At least one non-removed usable photo
   - Shipping enabled only when package weight is known or a safe default exists
4. Be ready to log into Facebook in the browser window opened by the worker if the configured profile is new or signed out.

## Smoke-Test Mode

Use draft mode only to verify selectors, login, and photo upload behavior:

```bash
npm run post:drafts
node scripts/facebook_marketplace_worker.js --ids example-001
node scripts/facebook_marketplace_worker.js --prefix batch-2026-01
node scripts/facebook_marketplace_worker.js --limit 5
```

The worker reads `/api/posting-queue`, filters to approved and valid listings, uploads photos in saved order, fills fields, takes screenshots, and stores results under `projects/default/posting-runs/`.

At startup, the worker first opens `https://www.facebook.com/marketplace` and waits for the login screen to clear. Posting begins only after the browser session appears ready.

## Live Posting Mode

Use this when the user clearly asks to post approved listings live to Facebook.

```bash
python3 - <<'PY'
from marketplace_bulk.storage import update_settings
print(update_settings({"auto_publish": True})["auto_publish"])
PY

node scripts/facebook_marketplace_worker.js --ids example-001 --live

python3 - <<'PY'
from marketplace_bulk.storage import update_settings
print(update_settings({"auto_publish": False})["auto_publish"])
PY
```

Do not leave `auto_publish=true` after a live-posting run unless the user explicitly asks for that.

## Worker Flags

- `--api http://127.0.0.1:8766`: use a non-default API URL.
- `--ids id1,id2`: post only specific listing IDs.
- `--prefix batch-prefix`: post only listings whose IDs start with the prefix.
- `--limit 5`: cap queue size for dry runs.
- `--live` or `--publish-approved`: allow final Publish clicks when Settings also permits it.

## Facebook UI Handling

Facebook Marketplace selectors change often. Prefer resilient Playwright patterns:

- Use labels, roles, and visible text before CSS class names.
- For dropdowns, click the visible field row, then select visible text from the opened left-panel menu.
- Verify category and condition were actually selected before moving on.
- Treat disabled `Next` or `Publish` buttons as blocking validation, not success.
- Only record `published` after clicking a visible enabled button named exactly `Publish`.
- Capture a screenshot on each failure.

The reusable logic is in `scripts/facebook_marketplace_worker.js`.

## Recovering From Stuck Runs

1. Stop the running worker process.
2. Set live posting off:

```bash
python3 - <<'PY'
from marketplace_bulk.storage import update_settings
print(update_settings({"auto_publish": False})["auto_publish"])
PY
```

3. Inspect the latest screenshot:

```bash
ls -t projects/default/posting-runs/*.png | head
```

4. Retry one listing in smoke-test mode:

```bash
node scripts/facebook_marketplace_worker.js --ids example-001
```

5. Patch selectors or listing validation before attempting another live-posting run.

## Research and Description Standards

Use the app as the source of truth. Additional web photos and comp links must be saved as provenance-backed candidates and reviewed before posting.

Descriptions should be public, concise, and factual:

```text
Selling [item name].

Quantity: [quantity wording].

Condition: [condition].

[Included items, visible accessories, dimensions, compatibility, or known limitations.]

Local pickup in [location]. Shipping available through Facebook when supported; buyer pays shipping.
```

Never include private notes such as "pipeline", "needs review", "from storage list", "untested by pipeline", "photo needed", or instructions to the owner.
