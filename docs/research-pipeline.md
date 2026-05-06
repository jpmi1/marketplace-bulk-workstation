# Research Pipeline Guide

This guide tells Codex, Claude Code, and other agents how to do product identification, price comps, information gathering, and extra photo discovery for this workstation.

The app is the source of truth. Research enriches listings; it does not bypass review.

## Permission Gates

Before doing web research, read Settings from the local API:

```bash
curl -s http://127.0.0.1:8766/api/settings
```

Respect these flags:

- `comp_research_enabled`: required before searching current prices or comp links.
- `image_research_enabled`: required before finding additional product/reference photos.
- `reference_image_policy`: controls whether web images are review-only or can be approved as reference assets.

If a flag is false, do not do that research. Leave a private note or validation flag instead.

## What To Research

For each listing that needs enrichment:

1. Identify the item from original photos, OCR, visible labels, model numbers, packaging, included parts, and user notes.
2. Research product facts from primary or high-quality sources such as manufacturer pages, official docs, product pages, manuals, and reputable retailers.
3. Research price comps from current marketplace sources such as eBay sold/active listings, Facebook Marketplace, Amazon used/new pricing, Mercari, OfferUp, and specialty resale sites.
4. Find extra images only when enabled, preferring product-page images from source links before broad image search.
5. Save uncertainty in `private_notes`, not public description.

## Price Comp Standards

Each comp should include:

- `url`
- `source_type`: `comp`
- `title`
- `observed_price`
- `condition`
- `date_captured`
- `confidence`: `high`, `medium`, or `low`
- `notes`

Recommended price should usually be the market median, adjusted for condition, missing accessories, quantity, local demand, and quick-sale preference if the user requested one.

Do not invent comps. If sources are thin or model match is uncertain, set confidence to `low`.

## Additional Photo Standards

Each web image candidate should include:

- `id`
- `uri`: thumbnail or preview URL for the app
- `source_url`: original image URL or source page URL
- `kind`: `web_candidate` or `reference_asset`
- `provenance`: source page/title/domain
- `rights_warning`
- `removed`: default `false`
- `cover`: default `false` unless selected by the user
- `sort_order`

Use `kind=web_candidate` for unapproved found images. Use `kind=reference_asset` only after explicit approval or when importing already-approved reference assets.

Never present reference images as original item photos. Public copy must not imply the user photographed or owns the exact reference image.

## Public Description Rules

Descriptions must be buyer-facing and factual:

```text
Selling [item name].

Quantity: [quantity wording].

Condition: [condition].

[Included items, visible accessories, dimensions, compatibility, or known limitations.]

Please confirm compatibility, sizing, and fit from the photos before buying.

Local pickup in [location]. Shipping available through Facebook when supported; buyer pays shipping.
```

Do not include:

- internal notes
- research notes
- confidence comments
- pipeline language
- "photo needed"
- "untested by pipeline"
- owner instructions

The backend sanitizes forbidden phrases, but agents should write clean copy before saving.

## Saving Research To The App

Fetch a listing:

```bash
curl -s http://127.0.0.1:8766/api/listings/example-001
```

Patch listing fields:

```bash
curl -s -X PATCH http://127.0.0.1:8766/api/listings/example-001 \
  -H 'Content-Type: application/json' \
  -d @examples/research_result_template.json
```

The patch body must be shaped like:

```json
{
  "data": {
    "title": "Researched Generic Item",
    "price": 25,
    "description": "Buyer-facing public copy only.",
    "private_notes": "Research summary and uncertainty for reviewer.",
    "comps": []
  }
}
```

Photo edits use the listing patch when adding/importing a full photo list, or the photo endpoint when updating one existing photo:

```bash
curl -s -X PATCH http://127.0.0.1:8766/api/listings/example-001/photos/example-001-photo-01 \
  -H 'Content-Type: application/json' \
  -d '{"data":{"removed":true}}'
```

After saving, the user must review and approve in the app before posting.

## Agent Checklist

- Confirm research settings before searching.
- Save source links and confidence.
- Keep private uncertainty out of public copy.
- Mark reference images with provenance and rights warnings.
- Do not auto-approve listings after research unless the user explicitly asks.
- Run validation by reloading the listing or opening the app.
- Do not commit local research outputs or real item details to GitHub.
