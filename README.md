# Bulk Facebook Marketplace Poster

![Bulk Facebook Marketplace Poster brand hero](docs/assets/bulk-marketplace-poster-1btc-hero.png)

Bulk Facebook Marketplace Poster is a local-first workstation for turning piles of used stuff into ready-to-post Facebook Marketplace listings. It ingests photo batches and inventory outputs, groups photos, centralizes listing edits in SQLite, drives Facebook Marketplace through Playwright, and records posting results without storing Facebook credentials.

The app also includes a side feature called `Path to 1 BTC`: a manual progress tracker for sale proceeds, BTC buys, cash set aside, and configurable goal tracking. The BTC goal amount is editable, so users can track toward 1 BTC, 0.1 BTC, or any target that fits their own plan.

1. Generate or import listing candidates.
2. Upload photos or inventory through the local app.
3. Review groups, titles, prices, descriptions, photos, shipping, and validation.
4. Use Codex or Claude Code for gated product cleanup and posting automation.
5. Use the browser worker to post approved listings live to Facebook.
6. Track sale proceeds in `Path to 1 BTC` when useful.
7. Use draft mode only as a smoke test because Facebook drafts are not a reliable review surface.

## Local App

Install dependencies:

```bash
pip install -e .
npm install
npm --prefix app/frontend install
```

Start the backend and import current outputs:

```bash
npm run app:import
```

For frontend development:

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

## Core Screens

- `Intake`: drag in item photos, review staging-based groups, split/remove mismatched photos, set covers, and create review listings.
- `Review`: edit buyer-facing listing fields, approve only valid listings, preserve photo choices, and add sale proceeds to the BTC side tracker.
- `Posting Queue`: see approved listings, use Facebook Marketplace shortcuts, and run the Playwright worker against selected IDs.
- `Path to 1 BTC`: set any BTC goal amount, current BTC owned, manual BTC/USD price, Kraken referral URL, and Google Sheet URL; add ledger entries and export CSV/XLSX.
- `Agent Setup`: copy scoped prompts for Codex or Claude Code.
- `Settings`: configure Facebook map location, pickup ZIP/place, listing defaults, browser profile path, research gates, posting gate, and BTC side tracker defaults.

## Local Photo Recognition

The app can enrich uploaded listings with on-device OCR and local vision-model recognition. It reuses the local Ollama pattern from the onsite media catalog pipeline: photos are resized into `projects/default/recognition-cache/`, sent to the configured local Ollama host, and OCR/barcode/model facts are saved back into listing state.

Defaults point at the existing local model setup:

- Host: `http://127.0.0.1:11435`
- Model: `qwen3-vl:4b`
- Model store: `/Volumes/Rewind-Data/ai/ollama-models`

OCR uses macOS Vision when available and Tesseract when installed. If the local vision model is unavailable, the app falls back to OCR-only notes instead of blocking intake.

Run recognition manually:

```bash
npm run recognize:local
python3 scripts/local_recognition.py --ids example-001,example-002
```

Recognition can improve placeholder titles, empty categories, tags, and generic descriptions, but it does not approve listings or post anything.

## Browser Worker

The worker reads approved, valid listings from the API and posts them through Facebook Marketplace in a persistent local browser profile. It never reads or stores credentials.

For pickup, the worker fills Facebook's Location field from the listing location. When a pickup place or ZIP is configured, the app can apply that value to listings and also add a buyer-facing pickup sentence to each description.

```bash
npm run post:live
```

Use draft mode only as a smoke test. It fills the form, tries to click Facebook's `Save draft` control, and records the result; live posting is the reliable final workflow.

To allow final Publish clicks, both conditions must be true:

- Settings has `Live-post approved listings` enabled.
- The worker is run with `--live` or `--publish-approved`.

```bash
npm run post:live
```

Target specific runs with:

```bash
node scripts/facebook_marketplace_worker.js --ids example-001,example-002 --live
node scripts/facebook_marketplace_worker.js --prefix batch-2026-01 --live
node scripts/facebook_marketplace_worker.js --limit 5
```

Screenshots and posting statuses are saved under `projects/default/posting-runs/` and in project state. See `docs/playwright-posting.md` for the full Codex/Claude Playwright workflow, recovery steps, and selector rules.

## Path to 1 BTC

`Path to 1 BTC` is manual and local-first. It does not buy, sell, move Bitcoin, or provide financial advice.

- Set the target goal amount in BTC.
- Track starting BTC owned.
- Record sale proceeds, cash set aside, BTC purchases, referral bonuses, and adjustments.
- Link a progress entry to a listing when useful.
- Export a Google Sheets-ready CSV or XLSX ledger.
- Store a Google Sheet URL for quick access.

The app includes a configurable Kraken referral link hidden behind the `Bitcoin on Kraken` button instead of displaying the full URL. Referral eligibility, bonus amounts, deposit requirements, and trading terms vary by offer and location.

## Agent Workflow

The app is designed to work with Codex or Claude Code. Use `Agent Setup` to copy the GitHub repo URL, setup commands, and scoped prompts for selected listings. Agents should use the local app API to save research results and must respect the research toggles in Settings.

See `docs/agent-onboarding.md` for setup and `docs/agent-playbook.md` for listing cleanup standards.

## Architecture

- `marketplace_bulk/`: Python listing engine, SQLite storage, validation, importers, and FastAPI app.
- `app/frontend/`: React/Vite approval dashboard.
- `scripts/facebook_marketplace_worker.js`: reusable Playwright posting worker.
- `scripts/local_recognition.py`: local OCR/vision enrichment runner.
- `docs/`: posting workflow, gated research pipeline, and agent onboarding.
- `examples/`: generic templates with no private listing data.

## Safe Data Rules

Do not commit real photos, browser profiles, SQLite project databases, posting screenshots, private inventory exports, or user-specific listing details. Keep public listing descriptions buyer-facing and keep private uncertainty in `private_notes`.

## Tests

```bash
npm test
node --check scripts/facebook_marketplace_worker.js
npm run frontend:build
```

The tests cover quantity normalization, description sanitization, persistent project state, photo state, approval validation, posting status preservation, BTC progress math, and progress exports.
