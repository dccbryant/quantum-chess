# Quantum Chess

A browser-based Quantum Chess game (single-page HTML/CSS/JS).

## Run locally

```bash
python -m http.server 4173 --bind 0.0.0.0
```

Then open:

- http://localhost:4173

## Troubleshooting: Codex PR banner

If Codex shows:

> "Codex does not currently support updating PRs that are updated outside of Codex. For now, please create a new PR."

Use this flow:

1. Make a new commit (even a small follow-up commit).
2. Ask Codex to create a **new PR** entry for that commit.
3. If needed, open/update the GitHub PR manually from your branch.

This message is a Codex PR integration limitation, not a game runtime error.
