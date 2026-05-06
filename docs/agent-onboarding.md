# Agent Onboarding

This app works best when a human uses the review dashboard and an agent such as Codex or Claude Code handles research, cleanup, and browser automation from the local repo.

## Recommended Workflow

1. Clone or open the GitHub repo:

```bash
git clone https://github.com/jpmi1/marketplace-bulk-workstation.git
cd marketplace-bulk-workstation
```

2. Install and run locally:

```bash
npm install
npm --prefix app/frontend install
npm run frontend:build
npm run app
```

3. Open `http://127.0.0.1:8766/`.
4. Use `Intake` to upload photos or import existing outputs.
5. Review listing groups, remove wrong photos, set covers, and create draft listings.
6. Use `Agent Setup` to copy a scoped prompt into Codex or Claude Code.
7. Let the agent research, improve, or post only the selected listings.

## Codex

Use the GitHub connector/plugin when available, or clone the repo locally and open it in Codex. The app's `Agent Setup` screen provides copyable prompts with selected listing IDs and local API instructions.

For GitHub writes, authenticate locally if needed:

```bash
gh auth login
```

## Claude Code

Open the cloned repo folder in Claude Code. Use the `Agent Setup` screen to copy scoped prompts for research, description cleanup, or approved posting.

For GitHub writes:

```bash
gh auth login
```

## Research Gates

Agents must read Settings before researching:

- `comp_research_enabled=true` is required for price research.
- `image_research_enabled=true` is required for extra photo discovery.
- Reference/web photos require review before posting.

## Posting Gates

Live posting is off by default. Agents may click final Publish only when:

- the user explicitly asks,
- the listing is approved and valid,
- Settings has `auto_publish=true`,
- the worker is run with `--live` or `--publish-approved`.

Otherwise use draft mode only as a smoke test. Facebook drafts are not a reliable final handoff surface:

```bash
npm run post:drafts
```

When the worker launches, it opens Facebook in the configured browser profile and waits for the user to finish any required login before it starts filling listings.

## Privacy

Do not commit local projects, uploaded photos, browser profiles, posting screenshots, SQLite databases, or private inventory exports.
