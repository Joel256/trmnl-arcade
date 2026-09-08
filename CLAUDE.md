# Gardener for a Week — TRMNL Arcade game

Design doc: docs/design.md (the GDD — read it before changing game rules)

## Layout
- src/games/garden.js — the game module (pure functions only)
- test/garden.test.js — run with `npm test`
- recipes/garden/ — the TRMNL plugin (settings.yml + full.liquid)

## Hard rules
- Game modules must be pure. Forbidden tokens are in test/games_are_pure.test.js.
- Never set state.result — views.js drops the move form once phase is 'over'.
- Damage is derived from the event schedule, never stored. Only cures are stored.
- DAY_MS must be 24h in committed code. Compressing it enables the dev skip move.
- wrangler.toml on the local-deploy branch is for deploying only. Never commit it.

## Deploy
git checkout local-deploy -- wrangler.toml && npx wrangler deploy && git checkout master -- wrangler.toml