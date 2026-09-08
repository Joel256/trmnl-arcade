# Gardener for a Week — Game Design Document

**A cozy solo gardening game for TRMNL Arcade.**

Author: Joel (GitHub: Joel256 · Persistent Productions · TRMNL Discord: zard256)
Repo: `github.com/Joel256/trmnl-arcade` (fork of `usetrmnl/trmnl-arcade`)
Test worker: `joel-arcade.persistentproductions.workers.dev`
Hardware: TRMNL OG (2-bit), firmware 1.8.14

**Status:** design locked, pre-implementation.
This document supersedes *The Week Long Garden — Project Handoff* and *— Development Plan*, both of which are now wrong on shelf size, flower roster, economy, fertilizer, pot styles and carry-over. Treat this as the living design document.

---

## 1. Concept

A solo, cozy gardening game. One seat, no opponent, no way to lose. The player spends about a minute a day on their phone buying and tending plants; the TRMNL on the wall shows the garden all day and changes on its own as real time passes. A season runs seven days and ends in a harvest.

**Design thesis: the phone is a control panel, the wall is the reward.** Every decision is small; the payoff is ambient.

**The loop.** Open the phone in the morning. Read what happened. Water everything with one tap. Spend the day's coins on a flower, protection, or fixing what went wrong. Close the phone. Look at the wall for the rest of the day.

---

## 2. Platform constraints (verified against source)

All of the following was checked against the cloned repo and TRMNL's docs, not remembered.

### The engine contract — `docs/writing-a-game.md`

One file in `src/games/` plus one line in `src/games/index.js`. Five exports:
`meta`, `initialState()`, `applyMove(state, seat, move)`, `publicView(state)`, `privateView(state, seat)`.

- `applyMove` must return a **new** state (no mutation) and throw on illegal moves; the thrown message is shown to the player in red.
- Setting `state.result` to a string ends the game. The engine flips `phase` to `'over'` on the next `advancePhase` call.
- `meta.seats: 1` works — `advancePhase` checks `Object.values(record.seats).every(Boolean)`, so a single claimed seat deals immediately.
- CI forbidden tokens (`test/games_are_pure.test.js`), complete list: `fetch(`, `env.`, `eval(`, `new Function`, `setTimeout`, `setInterval`, `XMLHttpRequest`, `WebSocket`, `import(`.
- `Date.now` is **not** on that list.

### The clock

The engine calls `rules.applyMove(record.state, Number(seat), move)` (3 args) and `rules.publicView(record.state)` (1 arg). Therefore:

```js
export function applyMove(state, seat, move, now = Date.now())
export function publicView(state, now = Date.now())
```

self-fill in production and pin in tests. This mirrors the repo's own documented `initialState(random = Math.random)` pattern.

**Status: pending upstream.** An issue proposes the better shape — the engine passing `now` explicitly from `index.js`. Write `garden.js` against an explicit `now` parameter and it works under either outcome.

To check: `gh issue list --repo usetrmnl/trmnl-arcade --state all`

### Storage — `src/store.js`

Cloudflare KV with `expirationTtl: 604800` (7 days), **re-applied on every save**. Sliding window from last write: an active garden never expires; one untouched for 7 straight days is deleted without warning. State is JSON-serialised, so numbers persist fine. Game IDs use a 32-char alphabet excluding `l o 0 1`.

### Phase and reset — `src/index.js`

`/again/{nonce}` returns 409 while `phase === 'playing'`, so a solo garden is protected from bystanders resetting it. The record is created on the first device poll, so the lobby QR appears with no player action. State JSON handed to the recipe already includes `phase`, `join_urls`, `rejoin_url`, `play_again_url`, `board` (the `publicView` output) and `result`.

### The phone page — `src/views.js`

Hardcoded: title, a "You are ___." line, an optional red `.error` paragraph, a grid from `view.rows` or `view.grids`, an optional second grid under a literal `<h2>Your fleet</h2>`, and **one text input named `move`**. Every cell is HTML-escaped — games cannot inject markup. Unicode and emoji pass through fine.

`privateView` **must** return `rows` (or `grids`) and `you`, or the page throws.

Player URLs are credentials with no recovery. Lost bookmark = lost seat.

### The TRMNL side — `recipes/`

A recipe is `settings.yml` + `full.liquid`, zipped: `zip -q -j arcade-garden.zip settings.yml full.liquid`. Import via Plugins → Private Plugin → Import new.

- `description` capped at **35 characters**; longer fails import with no useful error.
- `polling_url: https://{{ arcade_host }}/s/garden/{{ trmnl.device.friendly_id }}.json`, `refresh_interval: 15`, `arcade_host` a custom field defaulting to `arcade.trmnl.com`.
- Ship `full.liquid` only. One layout is the accepted bar.
- Framework gotchas: never nest `.layout` inside `.layout` (collapses to zero); anything beside a table needs an explicit flex basis; use framework classes (Grid, Flex, spacing utilities), custom CSS only at a genuine limitation.

### Multi-device — solved, no per-device work

The platform applies the device's palette class itself (`screen--color-4bwry` for BWRY, bit-depth tiers for OG/X). Every `bg--`/`text--` token dithers or snaps to that panel's inks automatically. **Inline SVG `<symbol>` + `<use>` avoids the image-hosting/CORS question entirely and is the framework's own approach.** Framework docs have a Device Preview picker covering OG 2-bit, X, and BWRY.

BWRY refreshes slower with more flashes, so its users favour low refresh rates — the garden's slow cadence suits it.

### Creator fund

TRMNL+ pays 80% of subscription revenue to creators, split 70% plugin authors / 30% strategic contributors. July 2026 pool was $5,908.79 total. There is no Arcade category in the strategic-contributor weighting, so **the recipe earnout is the only path with real money**: minimum 50 connections (installs + forks), pooled by playlist age, presence and impressions.

- Publish the recipe under Joel's own account. If TRMNL publishes it, install-based earnout goes to them.
- The GitHub username in TRMNL Account settings (`Joel256`) attributes OSS work.
- **Upstream beats self-hosting.** Self-hosting earns nothing on either path.
- Realistic expectation: beer money and a portfolio line.

Also needed before publishing: **TRMNL User API Key** (Account → Regenerate). Not yet generated.

---

## 3. Locked design decisions

**Time is real.** `startedAt` stamped at season start; everything derives from `now - startedAt` at 24h per day, anchored to when the player began. Timezone data isn't reachable from a game module, so day boundaries are personal to each player.

**Ledger state, not a world.** Nothing "runs" at rollover. Money = `START + GRANT × daysElapsed − spent`. Health = f(event schedule, player actions, now). The wall advances by itself because `publicView` derives from `now` on every device poll.

**Events pre-rolled at first planting.** The whole week's event types are fixed in state at `initialState()`. Views ask "which scheduled events have elapsed?" Targets resolve deterministically against live state at read time ("leftmost blooming pot") so events never fire into an empty pot. This is required, not stylistic: `publicView` can't write, and rolling dice on read would show a different disaster every 15 minutes.

**Events fire at the day boundary.** One event per day, at the same moment the daily grant arrives. The player opens the phone and the news is already there — and the wall showed it before they looked.

**Buy only, no selling.** The economy is an allowance. Nothing compounds, so there's no optimal loop to solve. Core tension: beauty now vs. reserve for hazards later.

**No failure state.** Hazards damage, never delete. Everything is recoverable with money or time.

**Watering is free and whole-garden.** One tap waters everything. It's the daily ritual, not a resource puzzle.

**Two clocks.** The *calendar* advances regardless of the player. The *growth* clock is per-plant and only ticks on days that plant was watered.

**Day 1 and day 7 are safe.** Hazards can only be pre-rolled on days 2–6, so every hazard has at least one check-in in which to react and nobody is robbed at the finish line.

---

## 4. Content

### Flowers (8, one per shelf slot)

| Flower | Glyph | Price | Silhouette on 1-bit | BWRY ink |
|---|---|---|---|---|
| Pansy | 🌸 | 60 | low two-tone "face" | dark face + yellow eye |
| Daisy | 🌼 | 70 | flat ray petals, dot centre | white |
| Tulip | 🌷 | 80 | closed cup, two leaves | red or yellow |
| Poppy | 🌺 | 90 | papery cup on wiry stem | red |
| Sunflower | 🌻 | 100 | tall stem, big disc | yellow |
| Marigold | 🏵️ | 110 | ruffled dense pom | yellow |
| Rose | 🌹 | 120 | bold cup, thorny stem | red |
| Hydrangea | 💮 | 130 | one big pom-pom cluster | white/gray |

Glyphs are phone-only. 🌺 stands in for poppy and 💮 for hydrangea — both approximations, both fine because the written name sits beside them in the shop.

**Rose warning:** at 90–150px on 2-bit the spiral turns to mud. Draw it as a bold dark cup with two or three thick curves, not a spiral.

### Growth stages (5)

| Stage | Name | Glyph |
|---|---|---|
| 1 | seed mound | 🌰 |
| 2 | sprout | 🌱 |
| 3 | bud | 🌿 |
| 4 | **bloom** | species glyph |
| 5 | seedhead | 🌾 |
| — | wilting | 🥀 |

One stage per watered day. Planted day 1 and watered daily → bloom on day 4, seedhead on day 5.

**Blooms hold.** A bloomed plant is exempt from wilting — it has earned its retirement — and gets a radiating sun/halo behind it on the wall. It remains vulnerable to hazards, so the back half of the week still has stakes.

### Wilting

| Days since watered | Phone | Wall |
|---|---|---|
| 0 | upright | normal sprite |
| 1 | 🥀 "drooping" | sprite rotated 9° |
| 2+ | 🥀 "wilting !" | sprite rotated 18° + slight vertical squash |

Recovery is instant on the next watering. **Wilt costs no art** — it's an SVG transform on the existing `<use>`, pivoting on the pot rim.

### Hazards (days 2–6 only)

Damage only. All pause that plant's growth until cured. A bad event damages `ceil(plantedPots / 4)` pots, minimum 1 — a crowded garden is genuinely harder to keep tidy.

| Hazard | Glyph | Effect | Cure | Prevent |
|---|---|---|---|---|
| Aphids | 🐛 | leaves speckle, growth pauses | 40 | Neem spray 35 · marigold neighbour |
| Wind gust | 💨 | pot tips, plant droops | 30 | Cloche 30 |
| Slug | 🐌 | chews the lowest plant | 35 | Eggshell ring 25 · marigold neighbour |
| Powdery mildew | 🍄 | white dusting; **spreads to a neighbour if uncured 2 days** | 60 | Fungicide dust 45 |
| Crow | 🐦 | pecks a seedhead back a stage | — | — |
| Heat wave | 🔥 | whole garden extra thirsty | free — water that day | — |
| Squirrel | 🐿️ | digs up a sprout (stage 1–2 only) | free — replant by watering | — |
| Frost (days 5–6) | ❄️ | frost overlay, growth stops | free — water that day covers plants | Cloche 30 |

Mildew is the only compounding hazard and the only urgency mechanic. Everything else waits patiently for tomorrow's grant.

Heat, squirrel and frost cost nothing to fix if you simply show up. They exist to make checking in feel worthwhile, not to take money.

### Bonuses

| Bonus | Glyph | Effect |
|---|---|---|
| Overnight rain | 🌧️ | counts as watering the whole garden |
| Butterfly / bee visit | 🦋 🐝 | +1 growth stage to one pot |
| Ladybug | 🐞 | auto-cures aphids if present, otherwise charming |
| Neighbour's gift | 🎁 | +80 coins |
| Found seed packet | ✉️ | free flower in an empty pot |
| Perfect sun | ☀️ | +half a day's growth to everything |
| Double rainbow | 🌈 | pure decoration for the day |
| Visitor bird | 🕊️ | lands on the tallest bloom |
| Market day (day 6) | 💰 | double grant if every pot is healthy |
| **Clear day** | 🌙 | nothing happens — named, not a silent gap |

### Companion planting

**Marigold protects the pots directly to its left and right, within its own row only.** Pots 1–4 are one row, 5–8 the other. Never vertical, never diagonal, never wrapping between rows. Protects against aphids and slugs.

Pot *order* becomes a decision with zero extra input, since the player already chooses the pot number.

### Event frequency

One slot per day, days 2–7 (hazards days 2–6 only). Base weighting quiet 20% / good 40% / bad 40%, with `badChance = min(0.55, 0.40 × plantedPots / 6)`.

Guarantees on the pre-roll (re-roll the schedule at init until satisfied): at least 2 good events, at most 3 bad, never bad on two consecutive days before day 5. Deterministic from the seed, so testable.

---

## 5. Economy

Tuned by simulating 1,000 seeded weeks against four player policies.

| Constant | Value |
|---|---|
| Starting coins | **500** |
| Daily grant | **200** (days 2–7) |
| Week total | **1,700** |
| Shelf slots | **8** (start owning 3) |
| Extra pot | **110** flat |
| Flowers | 60 / 70 / 80 / 90 / 100 / 110 / 120 / 130 |
| Mulch | 45 |
| Prevention | Eggshells 25 · Cloche 30 · Neem 35 · Fungicide 45 |
| Cures | Wind 30 · Slug 35 · Aphids 40 · Mildew 60 |
| Accessories | 150–250 |
| Backgrounds | 350 |

**Full shelf:** 550 in pots + 480 (cheapest flower ×8) = **1,030**, or 1,310 for one of each species.
**Everything at once:** roughly twice a season's income. Decoration is the aspiration, not the requirement.

### The load-bearing number

The whole difficulty curve hinges on one question: **can you afford all 8 pots and flowers by day 4?** A plant needs three watered days to bloom, so day-4 plantings bloom on day 7 and day-5 plantings never do. At 500 starting coins a daily player crosses that line 83% of weeks. At 600 it becomes 96%. This is a cliff, not a curve — treat these numbers as load-bearing.

### Simulated outcomes

| | Daily | Every 2nd day | Greedy (no repairs) | Twice a week |
|---|---|---|---|---|
| Fills the shelf | 100% | 100% | 100% | 0% |
| **Perfect garden** | **83%** | 1% | 23% | 0% |
| Blooms (median) | 8 of 8 | 5 of 8 | 8 but 2 wrecked | 3 of 3 |
| Hazards suffered | 1 | 1 | 4 | 1 |
| Coins left | 120 | 130 | 180 | 1,075 |

Two findings worth preserving:

- **Greedy sprawl grows just as many flowers but earns the top title only 23% of the time**, because hazards scale with garden size and uncured damage stops growth. The punishment for greed is a shelf that looks like a wreck on the wall, not poverty.
- **A twice-a-week player wastes 1,075 coins.** Absence isn't punished with hardship, it's punished with a garden you never got to spend on. That's the gentlest possible pressure to check in.

### Harvest tiers

| Tier | Requirement |
|---|---|
| **Master Gardener** | all 8 slots bought, planted, bloomed, none damaged |
| **Green Thumb** | 5+ blooms, at most 1 damaged |
| **Gardener** | 3+ blooms |
| **Sprout** | anything less |

Plus a separate **unbroken watering streak** mark, independent of blooms, so a player who showed up every day is acknowledged even when a squirrel ruined the picture. Effort and outcome are rewarded separately.

### Cut from earlier drafts

- **Fertilizer** — cut. Mulch is the only growth item, which makes the day-4 deadline a hard wall rather than a soft one.
- **Pot styles** — cut for v1 (see §10).
- **Accessory functional effects** — cut for v1. Accessories are purely cosmetic. Their effects were never simulated and shipping untested balance isn't worth it; the functional layer can return in v1.1.

---

## 6. Carry-over codes

Replaces the seed-packet mechanic entirely.

**Coins for catching up, cosmetics for excelling.** A perfect week must not snowball into an easier one — the economy cliff above means even 100 extra coins would push a daily player from 83% to near-certain.

| Blooms at harvest | Reward | Codes |
|---|---|---|
| 0–3 | **150 coins** | `FreshStart` · `NewSoil` · `SeedAndHope` · `BeginnerLuck` |
| 4–5 | **100 coins** | `SteadyHand` · `HalfInBloom` · `GoodSeason` · `WellWatered` |
| 6–7 | **50 coins** | `GreenThumb` · `FineGarden` · `AlmostPerfect` · `SevenBlooms` |
| 8 (Master Gardener) | **no coins — one cosmetic, already installed next season** | see below |

**Cosmetic gift codes (8).** The harvest screen offers three to choose from, so a perfect week ends in a small decision rather than a handout.

| Accessories | Backgrounds |
|---|---|
| `GnomeAtHome` | `JapaneseGarden` |
| `ChimesInTheWind` | `CoastalHarbour` |
| `BirdbathMorning` | `GreenhouseGlass` |
| `ScarecrowWatch` | |
| `ButterflyHouse` | |

A free background is worth 350 coins of decoration but does nothing to help fill the shelf, so it can't break the tuning.

**Rules.** Case-insensitive, spaces ignored ("green thumb" works). Entered as a day-1 move only. **20 codes total.**

*On forgery:* the repo is open source, so any scheme is forgeable. The best possible forge is 150 coins — under 9% of a season — which buys one extra flower and a slightly duller game. Readable phrases don't make this meaningfully worse and are far nicer to type.

---

## 7. Phone interface

### Universal chrome

Every screen carries, in this order: the game title, the page name as an `<h2>`, the header table, the page body, the nav.

**Header table** — three cells in row one, spanning cells below:

| DAY / **3** / of 7 | 💰 340 | +200 in 9h |
|---|---|---|
| 🌫️ It feels muggy today. | | |
| 🐛 Aphids have found the rose in pot 3. | | |

The news row is visually distinct (grey band) and carries one sentence about the most recent event.

**Nav** — the same four destinations on every screen, greyed when unavailable:
`🌱 Garden` (wide) · `💰 Shop` · `🌻 Harvest` · `📖 How to play`

- Harvest is greyed until day 7.
- Shop is greyed on day 7 — nothing bought then could bloom.

### Screens

1. **Lobby** — title, large centred QR, one line of instruction. The only QR in the game.
2. **Day 1** — all 8 slots visible so the goal is obvious before anything is bought. One primary button: "Plant your first flower." Code field at the bottom, below the fold.
3. **Garden** — the shelf, one wide Water button, then eight pot buttons showing number, stage glyph, and `!` when attention is needed.
4. **Shop** — forecast-relevant protection promoted to the top, then flowers (two per table row), garden, decoration.
5. **One pot** — status, neighbours stated in words, red line for whatever ails it, primary button to fix, secondary options.
6. **Harvest** — tier, tally, carry-over code shown large enough to photograph, brag line, "Start a new season."
7. **How to play** — a single table cell containing normal paragraphs.

### Input

The `controls()` PR renders declarative buttons. **The text input remains available per-view** and is used for code entry — so we are asking to hide it selectively, not remove it. If the PR is rejected entirely, the game still works via typed commands and How to Play carries the vocabulary.

---

## 8. Wall display (`full.liquid`)

**Pure art plus one line of text.** No coin counter, no QR (except lobby), no weather, no status HUD.

### Layout at 800×480

| Band | Height | Contents |
|---|---|---|
| Top | ~150px (31%) | Sky, hills, tree, trellis. **Day counter lives here.** |
| Middle | ~160px | Upper shelf: pots 1–4 |
| Bottom | ~170px | Lower shelf: pots 5–8, gnome and watering can at the ends |

Side margins ~40px. Each plant gets ~150px of height, which is where the OG's dithering still resolves petal detail.

**Day counter:** diegetic — a small hanging slate or seed-packet sign on the shelf frame or a fence post, reading `Day 3 / 7`. It's the only text on the wall, and putting it *in* the scene stops it reading as a HUD stamped over the art.

**States:** lobby (large centred QR + title) · playing (the garden) · harvest (the finished garden; no QR — the player starts the next season from their phone).

### Rendering

Layout with framework classes only: outer `layout` (never nested), CSS-grid shelf via `grid` utilities. Art as inline SVG `<symbol>` defs in Shared markup, one per species-stage, `<use>` per pot. Colour via framework tokens (`text--`/`bg--` and `currentColor` fills) so OG dithers, X grays and BWRY inks all resolve from ONE asset set.

Preview across OG 2-bit / X / BWRY with the framework docs' Device Preview; the physical OG validates for real.

**Art can start before the Worker is involved:** point a private plugin's polling URL at a static JSON file containing a hand-written `publicView` payload, and iterate Liquid and SVG on real hardware by editing the JSON to fake day 3 with aphids, day 7 harvest, and so on.

---

## 9. Move vocabulary

Buttons post the identical string a player would type, so there is one parser and no divergence.

### Actions

| Move | Effect |
|---|---|
| `water` | water everything (free, once per day, no-op if already watered) |
| `plant <flower> <pot>` | buy and place in one move — `plant rose 3` |
| `cure <pot>` | treat whatever ails that pot |
| `mulch <pot>` | survives one missed watering day |
| `guard <item> <pot>` | prevention — `guard neem 3`, `guard dust 3`, `guard shells 3`, `guard cloche 3` |
| `pot` | buy the next shelf slot |
| `compost <pot>` | clear the plant, keep the pot, free |
| `decor <name>` | buy an accessory |
| `bg <name>` | buy a background |
| `code <phrase>` | redeem a carry-over code (day 1 only) |
| `finish` | end the season; sets `state.result` |

### Navigation

The engine has no concept of screens, so navigation is state. These set `state.view` and change nothing else:

`garden` · `shop` · `open <pot>` · `harvest` · `help`

A bare number is shorthand for `open <n>`.

`help` prints the vocabulary via the error channel in the stock build.

### Notes

- An empty submit reaches `applyMove` as `''`. Treat it as a harmless refresh, not an error — casual players will tap Play with nothing typed.
- Throwing is the only per-turn text output, and it renders red. One sentence per turn; make it the one that matters.

---

## 10. Art

### The contract

- **One asset per species-stage, plant and pot together.** 8 species × 5 stages = 40.
- Pot silhouette, width and rim height **identical in every generation**. This is the only future-proofing that matters: it lets a later pass cut cleanly above the rim if pot styles ever return.
- Wilt is an SVG transform, not an asset.
- Hazard badges are small, shared across all species — one per hazard family, not per plant.

### Scope

| | Count |
|---|---|
| Plants: 8 species × 5 stages | 40 |
| Hazard badges (shared) | ~6 |
| Backgrounds (1 default + 3 purchasable) | 4 |
| Accessories | 5 |
| Day-counter sign | 1 |
| **Total** | **~56** |

### Pipeline

1. AI generates a reference sheet — **all five stages of one species in a single image**, side by side. Forty separate generations produce forty slightly different art styles; one image per species keeps the stages coherent.
2. Downscale to target size, threshold to 1-bit.
3. Trace to vector (potrace), fill with `currentColor`.
4. Hand-clean the paths.

**Generate a three-species test set first** — tulip, daisy, sunflower — wire them up, validate on the physical OG, *then* batch the rest. The SVG symbol contract only becomes concrete once the Liquid template exists, and discovering a sizing problem after forty assets is the expensive version of this lesson.

### Style prompt

> A cozy two-tier wooden potting-shelf holding exactly eight terracotta flower pots, four on the upper shelf and four on the lower shelf, viewed straight on from the front. The shelves occupy only the lower two-thirds of the image. The upper third is open garden scenery: distant rolling hills, a large tree at the far left, a flowering arched trellis at the far right, clear bright sky. Each pot holds one different flowering plant in full bloom — sunflower, rose, tulip, daisy on the upper shelf; pansy, poppy, marigold, hydrangea on the lower shelf. A small garden gnome sits at the right end of the lower shelf and a metal watering can rests at the left end. Leave a clear margin of empty space at the left and right edges. Detailed pen-and-ink engraving style, heavy crosshatching and stippling, pure black and white only, no grey fills — all shading through dot and line density like a vintage seed catalogue. Strong dark outlines on pots and flowers. Bright clean background with generous white space. No text, no numbers, no letters, no lettering anywhere. No border or frame. Landscape composition, 800 by 480 pixels.

Keep background detail **simpler and lighter** than the flowers. Fine stippling in hills is the first thing to become grey noise on the OG when it has to compete with eight detailed subjects.

---

## 11. Copy

### Weather hints — shown the day *before* the event

| Condition | Line | Could be |
|---|---|---|
| Muggy | *It feels muggy today.* | mildew · aphids |
| Windy | *The wind is picking up.* | wind gust · crow |
| Critters | *There are tracks in the garden.* | slug · squirrel |
| Hot | *It feels warm today.* | heat wave |
| Cold | *It feels chilly today.* | frost |
| Clear | *The sky looks clear.* | nothing |
| Day 6 | *Tomorrow is the harvest day.* | — |

The hint narrows the hazard to two possibilities, never one. A precise forecast made diligent players effectively invulnerable in simulation (95% perfect, hazards suffered near zero); vagueness keeps it honest.

### News lines — no time prefix

Day boundaries anchor to `startedAt`, so "last night" and "this morning" are false for most players. A bare statement reads like a gardener noticing something and is always true.

| Event | Line |
|---|---|
| Aphids | 🐛 Aphids have found the {flower} in pot {n}. |
| Wind | 💨 A gust has knocked over pot {n}. |
| Slug | 🐌 Something has been chewing the {flower} in pot {n}. |
| Mildew | 🍄 There's a white dust on the {flower} in pot {n}. |
| Crow | 🐦 A crow has been at the seedheads in pot {n}. |
| Heat | 🔥 It's been hot. Everything is thirsty. |
| Squirrel | 🐿️ A squirrel has dug up the sprout in pot {n}. |
| Frost | ❄️ There's frost on the {flower} in pot {n}. |
| Rain | 🌧️ It rained. Everything got a good drink. |
| Butterfly | 🦋 A butterfly spent the day on the {flower} in pot {n}. |
| Ladybug | 🐞 A ladybug has been working on pot {n}. |
| Gift | 🎁 A neighbour left you 💰80. |
| Packet | ✉️ Someone left a seed packet. Pot {n} has a {flower}. |
| Sun | ☀️ Perfect sun. Everything grew a little extra. |
| Rainbow | 🌈 There was a rainbow over the garden. |
| Bird | 🕊️ A bird sat on the {flower} in pot {n}. |
| Market day | 💰 Market day — your garden is healthy, so today's grant is doubled. |
| Clear | 🌙 A quiet day. Nothing to report. |

### How to play

> **Gardener for a Week** is played on your phone and watched on your TRMNL. You set your plants up here, then enjoy your garden on the wall all day.
>
> Every morning you get more 💰 to buy plants, deal with whatever found your garden overnight, and decorate. After seven days the season ends and you start again — different flowers, a different look, every week. The goal is a beautiful garden by Sunday.
>
> **Garden** — water everything with one tap. It's free, and it's the only thing you need to do each day. Plants only grow on days they were watered; miss a day and they droop. A **!** means a pot needs you.
>
> **Shop** — flowers, pots, protection and decoration. Keep a little back each day: fixing a hazard costs 💰30–60.
>
> **A pot** — open any pot to see how it's doing, treat what ails it, and mulch it so it survives a missed day. A plant takes a few days of watering to bloom, and you'll know when it does — it starts to shine. Nothing ever dies here. Everything can be fixed.
>
> **Harvest** — on Sunday your blooms earn a code that gives next season a head start. Save it, you earned it.
>
> **The weather** — the line under the day counter hints at what tonight might bring. It's never exact. Nothing bad ever happens on the first or last day.
>
> **Marigolds** look after the pots on either side of them.

### settings.yml

- `name`: **Gardener for a Week** (19 chars)
- `description`: **Grow a garden on your wall.** (27 chars — cap is 35)

---

## 12. State shape

```js
const DAY_MS = 24 * 60 * 60 * 1000   // set to 10 * 60 * 1000 for hardware playtests

state = {
  startedAt: 1756100000000,
  seed: 'k7mp2q',              // drives the event schedule
  view: 'garden',              // garden | shop | pot:3 | harvest | help
  pots: [                      // index = shelf position, 0-7
    { species: 'sunflower', plantedDay: 1,
      damage: { type: 'aphids', day: 3 } | null,
      guards: { aphids: true },   // prevention bought, lasts the season
      mulched: false },
    null,                      // owned but unplanted
  ],
  potsOwned: 3,                // max 8
  spent: 340,
  wateredOnDay: [1, 2, 3],
  accessories: ['gnome'],
  background: 'meadow',
  events: [                    // pre-rolled at init, immutable, fires at day boundary
    { day: 2, kind: 'good', type: 'butterfly' },
    { day: 3, kind: 'bad',  type: 'aphids' },
  ],
  carriedIn: { coins: 50, cosmetic: null } | null,
  result: null                 // set by applyMove; 'finish' or past day 7
}
```

### The derivation module

One module, called identically by `applyMove`, `publicView` and `privateView`:

`dayFor(state, now)` · `moneyFor(state, now)` · `elapsedEvents(state, now)` · `healthFor(state, potIdx, now)` · `stageFor(state, potIdx, now)`

This is the garden's version of battleship's one-reveal-flag rule: **two independent time calculations will drift, and the one that drifts is the one nobody is looking at.**

---

## 13. Upstream PR plan

Split in two. Each merged commit counts toward the strategic-contributor path anyway, so splitting costs nothing and establishes credibility before the larger ask.

### PR 1 — small, obviously general

| Change | Lines |
|---|---|
| `<h2>` label comes from `view.board_label` (default `"Board"`, empty string skips it) | ~2 |
| `table { width: 100% }` | 1 |
| Skip the "You are ___" seat line when `meta.seats === 1` | ~2 |

Nothing here is game-specific and chess/battleship are unaffected.

### PR 2 — `controls()`, after PR 1 merges

Optional export `controls(view, seat)` returning `[{ label, move, group?, wide?, disabled? }]`, rendered as `<button type="submit" name="move" value="…">`. Roughly 15 lines plus 4 CSS rules. Games without the export are untouched. Buttons post the identical string a player would type, so no game logic changes.

Pitch it as a general capability: chess gets Resign and Offer Draw, battleship gets a tappable grid.

**Critical gotcha:** the text input is also `name="move"`, so a clicked button posts *two* values and `form.get('move')` returns whichever is first in the document. Either render buttons above the input, or fix it properly in `index.js` with `form.getAll('move').find(v => v.trim()) || ''`.

Also in PR 2: allow a view to declare it doesn't need the text input. Framed as *selective hiding*, not removal — the garden still uses the input for code entry.

**File the clock issue first.** Its answer decides upstream vs self-host, and that decides whether these PRs matter at all.

---

## 14. Milestones

| | |
|---|---|
| **M0 — Environment** | ✅ Complete. Fork, Codespace, 82 tests passing, Cloudflare Worker live, KV configured, QR verified on the physical OG. |
| **M1 — Core logic** | `garden.js`: constants, state shape, derivation module, `plant`/`water`/`finish`, small `DAY_MS`. Goal: one pot growing on the real OG in the first sitting. |
| **M2 — Art test set** | Three species × five stages. Validate dithering on the physical OG before batching. |
| **M3 — Wall render** | `full.liquid` + SVG symbols, previewed across all three device profiles. |
| **M4 — Phone polish** | Full `privateView`, the `controls()` PR if welcomed. |
| **M5 — Upstream PR** | Game file + tests + recipe folder, disclosing the clock pattern, with screenshots from all three device previews plus a photo of the real OG. |
| **M6 — Publish** | Export recipe zip (needs the User API Key), publish under Joel's own account. Push toward 50 connections via TRMNL Discord #flex and r/trmnl. |

**Scope discipline:** the logic is a weekend; the art is the project. Get one pot growing on the wall before drawing anything not strictly needed.

### Tests to write

- Determinism under pinned `now` and `random`
- No mutation in `applyMove`
- Purity scan (no forbidden tokens)
- **"The wall never disagrees with the phone"** — `publicView` vs `privateView` derivations at random timestamps
- Event pre-roll guarantees hold (≥2 good, ≤3 bad, no consecutive bad before day 5, none on days 1 or 7)
- Carry-over codes round-trip; unknown codes fail gracefully

---

## 15. Known limitations and workarounds

| Cannot do | Why | Workaround |
|---|---|---|
| Push to the screen on a schedule | Device pulls every 15 min; game runs only in request handlers | Derive display from `now` in `publicView`; the poll does the animating |
| Enforce a real 24h lockout | No timers, and a hard gate is hostile anyway | Day boundaries gate income and events, not play |
| Buttons/images on the stock phone page | `views.js` escapes all view data; one text input | The `controls()` PR; typed commands as fallback |
| Cross-season memory server-side | Games never receive `env` — structural, not a rule | Carry-over codes; the player is the database |
| Leaderboards / cross-game state | Same isolation | Deliberately skipped. Solo cozy; share codes socially |
| Survive 7 days of no writes | Sliding KV TTL | Fine for daily players; the abandoned garden stays on the wall until it expires |
| Know the player's timezone | Engine forwards nothing from the request into views | Anchor to `startedAt`; avoid "last night" in all copy |
| Per-device pixel art | Three panels, three palettes | One inline-SVG set + framework tokens; the platform adapts |
| Long recipe description | 35-char cap fails silently | Tagline in `settings.yml`, real description on the listing |

---

## 16. Still open

1. **The clock issue** — filed? answered? Gates M5, not M1.
2. **Recipe ownership** — confirm a contributed game's recipe can be published from the author's account, for creator-fund attribution.
3. **TRMNL User API Key** — not yet generated. Needed at publish time only.
4. **Which three backgrounds** ship alongside the default.
5. **Does the news row persist all day, or clear once the player acts?** Currently specced as persistent.
