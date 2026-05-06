# Sell to 1 BTC

Sell to 1 BTC is a local-first app for selling used stuff on Facebook Marketplace and manually tracking progress toward owning 1 BTC. It can ingest photo-folder outputs and Excel/CSV inventory outputs, centralize edits in a SQLite project database, provide a React approval dashboard, export approved posting queues, drive Facebook Marketplace through the user's logged-in browser profile, and maintain a BTC progress ledger.

1. Generate or import listing candidates.
2. Upload photos or inventory through the local app.
3. Review and edit every listing field in the app.
4. Use Codex or Claude Code for gated research and cleanup.
5. Use the browser worker to post approved listings live to Facebook.
6. Track sale proceeds and manual BTC buys on the `BTC Goal` screen.
7. Use draft mode only as a smoke test because Facebook drafts are not a reliable review surface.

## Local App

Install dependencies:

```bash
pip install -e .
npm install
npm --prefix app/frontend install
```

Start the backend and import the current outputs:

```bash
npm run app:import
```

In another terminal, run the React/Vite frontend:

```bash
cd app/frontend
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

Build the frontend for the backend to serve directly:

```bash
cd app/frontend
npm run build
python3 ../../scripts/marketplace_app.py
```

Then open `http://127.0.0.1:8766`.

## Photo Intake

Open the `Intake` screen, drag in item photos, review the timestamp/filename groups, remove mismatched photos, set cover photos, and create `needs_review` listings. Uploaded files are copied into the local project folder and should never be committed.

## BTC Goal

Open the `BTC Goal` screen to track progress toward `1.00000000 BTC`. The tracker is manual and local-first:

- record sale proceeds, cash set aside, BTC purchases, referral bonuses, and adjustments
- link a progress entry to a listing when useful
- enter BTC owned and BTC/USD price manually
- export a Google Sheets-ready CSV or XLSX ledger
- store a Google Sheet URL for quick access

The app includes a configurable Kraken referral link that is hidden behind the BTC Goal screen's Bitcoin on Kraken button instead of displaying the full URL. Replace it in Settings for other deployments. Referral eligibility, bonus amounts, and deposit/trading terms vary by Kraken offer and location.

## Codex and Claude Code

The app is designed to work best with Codex or Claude Code. Use the `Agent Setup` screen to copy the GitHub repo URL, setup commands, and scoped prompts for selected listings. Agents should use the local app API to save research results and should respect the research toggles in Settings.

See `docs/agent-onboarding.md` for the full setup flow.

## Browser Worker

The worker reads approved, valid listings from the API and posts them through Facebook Marketplace in a persistent local browser profile. It never reads or stores credentials.

```bash
npm run post:live
```

To allow final Publish clicks, both conditions must be true:

- Settings page has `Live-post approved listings` enabled.
- The worker is run with `--live` or `--publish-approved`.

```bash
npm run post:live
```

Screenshots and posting statuses are saved under `projects/default/posting-runs/` and in project state.

Target specific runs with:

```bash
node scripts/facebook_marketplace_worker.js --ids example-001,example-002
node scripts/facebook_marketplace_worker.js --prefix batch-2026-01
node scripts/facebook_marketplace_worker.js --limit 5
```

See `docs/playwright-posting.md` for the full Codex/Claude Playwright workflow, recovery steps, and selector rules.

## Reusable Architecture

- `marketplace_bulk/` contains the Python listing engine, SQLite storage, validation, importers, and FastAPI app.
- `app/frontend/` contains the React/Vite approval dashboard.
- `scripts/facebook_marketplace_worker.js` contains the reusable Playwright posting worker.
- `docs/agent-playbook.md` explains how Codex or Claude Code should identify products, research comps/photos, write descriptions, and preserve confidence flags.
- `docs/research-pipeline.md` explains the gated research workflow for price comps, product facts, and additional images.
- `docs/agent-onboarding.md` explains how to open the repo in Codex or Claude Code and connect GitHub safely.
- `AGENTS.md` and `CLAUDE.md` give future coding agents the repo rules for safe automation and Git hygiene.

## Review Dashboard

Every listing field is editable before approval:

- Title, price, condition, category, quantity wording, description, location, pickup/shipping mode, package weight, private notes, and reference-only approval.
- Photo carousel, cover selection, remove/restore, drag reorder, provenance, and rights warnings.
- Central validation blocks approval when required fields are missing, forbidden public phrases leak into descriptions, photos are missing, or shipping lacks a package weight/default.

## Settings

The Settings page controls location, defaults, shipping behavior, browser profile path, batch size, research toggles, reference-image policy, description tone, forbidden public phrases, BTC goal fields, Google Sheet URL, and Kraken referral URL.

## Generic Templates

- `examples/generic_template_item.json` shows the listing shape used by the local project store.
- `examples/generic_inventory_template.csv` shows a simple inventory upload shape.
- `examples/research_result_template.json` shows the patch format agents can use to save research results back to the app.
- `examples/sample_project.json` shows a generic demo project shape.

These examples are intentionally generic. Do not commit real photos, inventory exports, posting outputs, browser profiles, or SQLite project databases.

## Tests

```bash
npm test
```

The tests cover quantity normalization, description sanitization, persistent project state, photo state, approval validation, BTC progress math, and progress exports.
