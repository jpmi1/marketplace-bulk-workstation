# Facebook Marketplace Bulk Listing Workstation

This repo is a local-first workstation for bulk Facebook Marketplace listings. It can ingest photo-folder outputs and Excel/CSV inventory outputs, centralize edits in a SQLite project database, provide a React approval dashboard, export approved posting queues, and drive Facebook Marketplace through the user's logged-in browser profile.

1. Generate or import listing candidates.
2. Review and edit every listing field in the app.
3. Approve only valid listings.
4. Use the browser worker to create Facebook drafts.
5. Publish manually by default, or enable auto-publish explicitly in Settings.

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

## Browser Worker

The worker reads approved, valid listings from the API and fills Facebook Marketplace drafts in a persistent local browser profile. It never reads or stores credentials.

```bash
npm run post:drafts
```

Draft-and-confirm is the default. To allow final Publish clicks, both conditions must be true:

- Settings page has `Auto-publish approved listings` enabled.
- The worker is run with `--publish-approved`.

```bash
npm run post:approved
```

Screenshots and posting statuses are saved under `projects/default/posting-runs/` and in project state.

## Reusable Architecture

- `marketplace_bulk/` contains the Python listing engine, SQLite storage, validation, importers, and FastAPI app.
- `app/frontend/` contains the React/Vite approval dashboard.
- `scripts/facebook_marketplace_worker.js` contains the reusable Playwright posting worker.
- `docs/agent-playbook.md` explains how Codex or Claude Code should identify products, research comps/photos, write descriptions, and preserve confidence flags.

## Review Dashboard

Every listing field is editable before approval:

- Title, price, condition, category, quantity wording, description, location, pickup/shipping mode, package weight, private notes, and reference-only approval.
- Photo carousel, cover selection, remove/restore, drag reorder, provenance, and rights warnings.
- Central validation blocks approval when required fields are missing, forbidden public phrases leak into descriptions, photos are missing, or shipping lacks a package weight/default.

## Settings

The Settings page controls location, defaults, shipping behavior, browser profile path, batch size, research toggles, reference-image policy, description tone, and forbidden public phrases.

## Generic Templates

- `examples/generic_template_item.json` shows the listing shape used by the local project store.
- `examples/generic_inventory_template.csv` shows a simple inventory upload shape.

These examples are intentionally generic. Do not commit real photos, inventory exports, posting outputs, browser profiles, or SQLite project databases.

## Tests

```bash
npm test
```

The tests cover quantity normalization, description sanitization, persistent project state, photo state, and approval validation.
