# Agent Playbook: Marketplace Bulk Listings

This repo is designed for a local-first human review loop. Codex, Claude Code, or another agent can help research and draft, but the app should preserve source links, confidence, and user approvals instead of guessing.

## Core Rules

- Never store Facebook credentials. Use the user's configured browser profile and let the worker pause for browser login when needed.
- Default to local review-and-confirm. Live posting requires both an approved listing and `auto_publish=true` in Settings.
- Keep original photos untouched. Copy or download posting assets only into managed project output folders.
- Public listing descriptions must be buyer-facing. Do not include phrases like `storage inventory`, `pipeline`, `notes from sheet`, `photos still need`, or internal review instructions.
- Web images are candidates/reference material. Do not post them as real item photos unless the user has explicitly approved reference-only posting and the listing clearly avoids implying they are original photos.

## Photo/OCR Identification Workflow

1. Group photos by timestamp burst and visual similarity.
2. Inspect visible labels, model numbers, dimensions, serial plates, packaging, and accessories.
3. Use OCR when labels, boxes, or tags are readable.
4. Draft a title that names the item plainly without unsupported claims.
5. Mark uncertain brand/model/compatibility in private notes and validation flags, not public copy.

## Comp Research Workflow

Only research comps when `comp_research_enabled=true` in Settings.

1. Search current sources such as eBay active/sold listings, manufacturer pages, Facebook Marketplace, Amazon, and specialty resale sites.
2. Save source URL, observed price, condition, date captured, and confidence.
3. Recommend a market-median price unless the user chooses quick-sale or premium pricing.
4. Use the sheet cost only as a fallback anchor when comps are unavailable.
5. Flag pricing confidence as low when model, condition, quantity, or photos are uncertain.

## Additional Image Research

Only research additional images when the user has enabled image research in Settings.

1. Prefer product-page images from source-sheet links before broad image search.
2. Save provenance for every candidate: image URL, source page, title, source domain, and captured date.
3. Label candidates as `web_candidate` or `reference_asset`.
4. Require user review for wrong matches, rights concerns, and reference-only use.
5. Preserve remove/restore and cover-photo decisions in project state.

## Description Template

Use a clean Facebook-friendly layout:

```text
Selling [item name].

Quantity: [exact count or 5+ available].

Condition: [New / Used mix from reviewed data].

[One or two factual details about included parts, compatibility, dimensions, or visible accessories.]

Please confirm compatibility, sizing, and fit from the photos before buying.

Local pickup in [location]. Shipping available through Facebook when supported; buyer pays shipping.
```

Avoid owner-facing notes, unsupported testing claims, private pricing logic, and "AI/pipeline" language.

## Posting Workflow

1. Import or generate listings.
2. Review every field in the app: title, price, condition, category, quantity, description, location, shipping, weight, notes, photos.
3. Resolve validation errors.
4. Approve listings.
5. Use draft mode only as a smoke test; it will wait for browser login before filling listings.
6. For the final workflow, run live posting for approved listings because Facebook drafts are not a reliable review surface.

## Playwright Automation Workflow

Use `scripts/facebook_marketplace_worker.js` for Facebook automation. Do not create one-off browser scripts unless the reusable worker cannot handle a current Facebook UI change.

Common commands:

```bash
node scripts/facebook_marketplace_worker.js --ids example-001
node scripts/facebook_marketplace_worker.js --prefix batch-2026-01
node scripts/facebook_marketplace_worker.js --limit 5
```

Automatic posting requires explicit user approval plus both publish gates:

```bash
python3 - <<'PY'
from marketplace_bulk.storage import update_settings
update_settings({"auto_publish": True})
PY

node scripts/facebook_marketplace_worker.js --ids example-001 --live

python3 - <<'PY'
from marketplace_bulk.storage import update_settings
update_settings({"auto_publish": False})
PY
```

Record a listing as `published` only after clicking a visible enabled Facebook button named exactly `Publish`. Clicking `Next` is progress, not proof of publication. If Facebook stalls, inspect the latest screenshot in `projects/default/posting-runs/`, retry one listing in smoke-test mode, and patch the reusable worker selectors.

For the complete operational checklist, see `docs/playwright-posting.md`.

For the gated research workflow and JSON patch contract, see `docs/research-pipeline.md`.
