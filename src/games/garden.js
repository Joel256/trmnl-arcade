// Gardener for a Week — a solo, cozy gardening game.
//
// Time is real: everything derives from `now - state.startedAt`. The engine calls
// applyMove(state, seat, move) and publicView(state), so `now` is a default
// parameter — the same shape the repo already uses for initialState(random).
// Pin it in tests; it self-fills in production.
//
// Damage is DERIVED, not stored. Events fire at a day boundary with no player
// action, and publicView cannot write, so there is nobody to record "aphids hit
// pot 3" at the moment it happens. Instead the whole week is replayed from the
// pre-rolled schedule on every read; state records only what the player *paid
// for* (state.cures). This is what lets the wall change while nobody is looking.
//
// The season never formally ends. `state.result` is deliberately never set,
// because advancePhase would flip the record to 'over' and views.js drops the
// move form at that point, leaving a solo player with no way to act. A
// `newseason` move resets the garden in place instead.

const REAL_DAY_MS = 24 * 60 * 60 * 1000

export const DAY_MS = REAL_DAY_MS // set to 10 * 60 * 1000 to play a week in ~70 minutes

// Playtest helpers switch on automatically when the day length is compressed, so
// there is only one knob to remember and no way to ship a skip button by accident.
export const DEV = DAY_MS < REAL_DAY_MS

const DAYS = 7
const START_COINS = 500
const DAILY_GRANT = 200
const START_POTS = 3
const MAX_POTS = 8
const POT_PRICE = 110
const MULCH_PRICE = 45
const BACKGROUND_PRICE = 350
const ROW = 4 // two rows of four; companion planting never crosses rows

export const FLOWERS = {
  pansy: { price: 60, glyph: '🌸' },
  daisy: { price: 70, glyph: '🌼' },
  tulip: { price: 80, glyph: '🌷' },
  poppy: { price: 90, glyph: '🌺' },
  sunflower: { price: 100, glyph: '🌻' },
  marigold: { price: 110, glyph: '🏵️' },
  rose: { price: 120, glyph: '🌹' },
  hydrangea: { price: 130, glyph: '💮' }
}
const FLOWER_NAMES = Object.keys(FLOWERS)

const GUARDS = {
  shells: { price: 25, blocks: ['slug'], label: 'Eggshell ring' },
  cloche: { price: 30, blocks: ['wind'], label: 'Cloche' },
  neem: { price: 35, blocks: ['aphids'], label: 'Neem spray' },
  dust: { price: 45, blocks: ['mildew'], label: 'Fungicide dust' }
}
const CURES = { wind: 30, slug: 35, aphids: 40, mildew: 60 }
const CURABLE = Object.keys(CURES)

// Marigold looks after the pots either side of it, within its own row.
const COMPANION_BLOCKS = ['aphids', 'slug']

const ACCESSORIES = { gnome: 150, chime: 175, birdbath: 200, scarecrow: 225, butterflyhouse: 250 }
const BACKGROUNDS = ['meadow', 'japanese', 'coastal', 'greenhouse']

// heat and frost are global: they cost nothing to fix, they just mean mulch
// cannot cover that day. Everything else targets pots.
const GLOBAL_HAZARDS = ['heat', 'frost']
const HAZARDS = [...CURABLE, 'crow', 'squirrel', ...GLOBAL_HAZARDS]
const GOODS = ['rain', 'butterfly', 'ladybug', 'gift', 'sun', 'rainbow', 'bird']

const FORECAST = {
  mildew: 'It feels muggy today.', aphids: 'It feels muggy today.',
  wind: 'The wind is picking up.', crow: 'The wind is picking up.',
  slug: 'There are tracks in the garden.', squirrel: 'There are tracks in the garden.',
  heat: 'It feels warm today.', frost: 'It feels chilly today.'
}
const CLEAR_FORECAST = 'The sky looks clear.'

const CARRY_CODES = {
  freshstart: 150, newsoil: 150, seedandhope: 150, beginnerluck: 150,
  steadyhand: 100, halfinbloom: 100, goodseason: 100, wellwatered: 100,
  greenthumb: 50, finegarden: 50, almostperfect: 50, sevenblooms: 50
}
const COSMETIC_CODES = {
  gnomeathome: { kind: 'accessory', id: 'gnome' },
  chimesinthewind: { kind: 'accessory', id: 'chime' },
  birdbathmorning: { kind: 'accessory', id: 'birdbath' },
  scarecrowwatch: { kind: 'accessory', id: 'scarecrow' },
  butterflyhouse: { kind: 'accessory', id: 'butterflyhouse' },
  japanesegarden: { kind: 'background', id: 'japanese' },
  coastalharbour: { kind: 'background', id: 'coastal' },
  greenhouseglass: { kind: 'background', id: 'greenhouse' }
}

export const meta = {
  name: 'Gardener for a Week',
  seats: 1,
  moveLabel: 'Type a pot number, or "help"'
}

// ---------------------------------------------------------------- pre-roll

function rollEvents(random) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const events = []
    for (let day = 2; day <= DAYS; day++) {
      const roll = random()
      // Day 1 is safe, and a day-7 hazard could not be reacted to in time.
      const hazardsAllowed = day < DAYS
      if (roll < 0.4 && hazardsAllowed) {
        events.push({ day, kind: 'bad', type: HAZARDS[Math.floor(random() * HAZARDS.length)] })
      } else if (roll < 0.8) {
        events.push({ day, kind: 'good', type: GOODS[Math.floor(random() * GOODS.length)] })
      } else {
        events.push({ day, kind: 'quiet' })
      }
    }
    const good = events.filter((e) => e.kind === 'good').length
    const bad = events.filter((e) => e.kind === 'bad').length
    const backToBackEarly = events.some(
      (e, i) => i > 0 && e.kind === 'bad' && events[i - 1].kind === 'bad' && e.day < 5
    )
    if (good >= 2 && bad <= 3 && !backToBackEarly) return events
  }
  return []
}

const emptyPot = () => ({ species: null, plantedDay: 0, guards: {}, mulched: false })

export function initialState(random = Math.random, now = Date.now()) {
  return {
    startedAt: now,
    view: 'garden',
    seasonNo: 1,
    pots: Array.from({ length: START_POTS }, emptyPot),
    spent: 0,
    wateredOnDay: [],
    cures: [], // { pot, day, curedDay } — the only record of damage the game keeps
    accessories: [],
    background: 'meadow',
    events: rollEvents(random),
    carriedIn: null,
    lastCode: null,
    result: null // never set — see the note at the top of this file
  }
}

// ---------------------------------------------------------------- derivation

const clone = (state) => JSON.parse(JSON.stringify(state))

export function dayFor(state, now = Date.now()) {
  const raw = 1 + Math.floor((now - state.startedAt) / DAY_MS)
  return { raw, day: Math.min(Math.max(raw, 1), DAYS), over: raw > DAYS }
}

export function elapsedEvents(state, now = Date.now()) {
  const { day } = dayFor(state, now)
  return state.events.filter((e) => e.day <= day)
}

const rowMates = (index) => {
  const start = Math.floor(index / ROW) * ROW
  return [index - 1, index + 1].filter((i) => i >= start && i < start + ROW)
}

// Replay the whole week from the schedule. Damage exists here and nowhere else.
function simulate(state, today) {
  const pots = state.pots
  const n = pots.length
  const damage = new Array(n).fill(null)
  const growth = new Array(n).fill(0)
  const lastWatered = new Array(n).fill(0)
  const todayLog = []

  const eventOn = (d) => state.events.find((e) => e.day === d)
  const isPlanted = (i, d) => Boolean(pots[i].species) && pots[i].plantedDay < d
  const plantedOn = (d) => pots.map((_, i) => i).filter((i) => isPlanted(i, d))

  const immune = (i, type, d) => {
    const guardDay = Object.entries(pots[i].guards || {})
      .find(([kind]) => GUARDS[kind] && GUARDS[kind].blocks.includes(type))
    if (guardDay && guardDay[1] < d) return true
    if (COMPANION_BLOCKS.includes(type)) {
      return rowMates(i).some((j) => pots[j] && pots[j].species === 'marigold' && pots[j].plantedDay < d)
    }
    return false
  }

  const note = (d, type, index) => { if (d === today) todayLog.push({ type, index }) }

  for (let d = 1; d <= today; d++) {
    const event = eventOn(d)

    // 1. the event lands at the day boundary, with no player action
    if (event && event.kind === 'bad' && !GLOBAL_HAZARDS.includes(event.type)) {
      const planted = plantedOn(d)
      const hits = Math.max(1, Math.ceil(planted.length / 4))
      const eligible = planted.filter((i) => !damage[i] && !immune(i, event.type, d))
      for (const i of eligible.slice(0, hits)) {
        if (CURABLE.includes(event.type)) { damage[i] = { type: event.type, day: d }; note(d, event.type, i) }
        else if (event.type === 'crow' && growth[i] >= 4) { growth[i] = Math.max(3, growth[i] - 1); note(d, 'crow', i) }
        else if (event.type === 'squirrel' && growth[i] < 2) { growth[i] = 0; note(d, 'squirrel', i) }
      }
    }
    if (event && event.kind === 'bad' && GLOBAL_HAZARDS.includes(event.type)) note(d, event.type, -1)
    if (event && event.kind === 'good') {
      if (event.type === 'ladybug') {
        const sick = damage.findIndex((entry) => entry && entry.type === 'aphids')
        if (sick >= 0) { damage[sick] = null; note(d, 'ladybug', sick) }
      } else note(d, event.type, plantedOn(d)[0] ?? -1)
    }

    // 2. anything the player paid to fix on this day
    for (const cure of state.cures) {
      if (cure.curedDay === d && damage[cure.pot] && damage[cure.pot].day === cure.day) {
        damage[cure.pot] = null
      }
    }

    // 3. growth resolves at the end of the day
    const rained = Boolean(event && event.type === 'rain')
    const harsh = Boolean(event && GLOBAL_HAZARDS.includes(event.type))
    for (let i = 0; i < n; i++) {
      if (!pots[i].species || pots[i].plantedDay > d) continue
      const watered = rained || state.wateredOnDay.includes(d) ||
        (!harsh && pots[i].mulched && state.wateredOnDay.includes(d - 1))
      if (watered) lastWatered[i] = d
      // The day a seed goes in is day zero for it: a plant sown and watered on
      // Monday is still a seed mound on Monday. Bloom lands on day 4, seedhead
      // on day 5, which is what makes day 4 the last useful planting day.
      if (damage[i] || !watered || pots[i].plantedDay >= d) continue
      growth[i] += 1
      if (event && event.type === 'sun') growth[i] += 0.5
      if (event && event.type === 'butterfly' && plantedOn(d)[0] === i) growth[i] += 1
    }

    // 4. mildew spreads to a neighbour if left for two days
    for (let i = 0; i < n; i++) {
      if (!damage[i] || damage[i].type !== 'mildew' || d - damage[i].day < 2) continue
      const victim = rowMates(i).find(
        (j) => isPlanted(j, d + 1) && !damage[j] && !immune(j, 'mildew', d)
      )
      if (victim !== undefined) { damage[victim] = { type: 'mildew', day: d }; note(d, 'mildew', victim) }
    }
  }

  return { damage, growth, lastWatered, todayLog }
}

export function snapshot(state, now = Date.now()) {
  const { raw, day, over } = dayFor(state, now)
  const events = elapsedEvents(state, now)
  const sim = simulate(state, day)

  let bonusCoins = 0
  for (const event of events) if (event.type === 'gift') bonusCoins += 80
  // Market day: doubled grant if every planted pot is healthy at the day-6 boundary.
  if (day >= 6) {
    const onSix = simulate(state, 6)
    if (onSix.damage.every((entry) => !entry)) bonusCoins += DAILY_GRANT
  }

  const carried = state.carriedIn ? state.carriedIn.coins : 0
  const coins = START_COINS + carried + DAILY_GRANT * (day - 1) + bonusCoins - state.spent

  const pots = state.pots.map((pot, index) => {
    const base = { index, owned: true, guards: pot.guards || {}, mulched: Boolean(pot.mulched) }
    if (!pot.species) return { ...base, empty: true }
    const growth = sim.growth[index]
    const stage = Math.min(5, 1 + Math.floor(growth))
    const bloomed = stage >= 4
    const dryDays = bloomed ? 0 : day - sim.lastWatered[index]
    return {
      ...base,
      empty: false,
      species: pot.species,
      glyph: FLOWERS[pot.species].glyph,
      plantedDay: pot.plantedDay,
      damage: sim.damage[index],
      stage,
      bloomed,
      seeded: stage === 5,
      dryDays,
      wilting: dryDays >= 1,
      needsYou: Boolean(sim.damage[index]) || (dryDays >= 1 && !bloomed)
    }
  })
  while (pots.length < MAX_POTS) pots.push({ index: pots.length, empty: true, owned: false })

  const blooms = pots.filter((p) => p.bloomed).length
  const planted = pots.filter((p) => !p.empty).length
  const damaged = pots.filter((p) => p.damage).length

  return {
    day, raw, over, coins, pots, events, blooms, planted, damaged,
    potsOwned: state.pots.length,
    seeded: pots.filter((p) => p.seeded).length,
    streak: state.wateredOnDay.length,
    wateredToday: state.wateredOnDay.includes(day),
    tier: tierFor({ blooms, planted, damaged, potsOwned: state.pots.length }),
    forecast: forecastFor(state, day),
    news: newsFor(sim.todayLog, state, day),
    grantIn: grantText(state, now)
  }
}

function tierFor({ blooms, planted, damaged, potsOwned }) {
  if (potsOwned === MAX_POTS && planted === MAX_POTS && blooms === MAX_POTS && damaged === 0) {
    return 'Master Gardener'
  }
  if (blooms >= 5 && damaged <= 1) return 'Green Thumb'
  if (blooms >= 3) return 'Gardener'
  return 'Sprout'
}

// The hint points at tomorrow and narrows a hazard to two possibilities, never
// one. A precise forecast makes attentive players effectively invulnerable.
function forecastFor(state, day) {
  if (day >= DAYS) return 'The season is complete.'
  if (day === DAYS - 1) return 'Tomorrow is the harvest day.'
  const tomorrow = state.events.find((e) => e.day === day + 1)
  if (!tomorrow || tomorrow.kind !== 'bad') return CLEAR_FORECAST
  return FORECAST[tomorrow.type] || CLEAR_FORECAST
}

// No time prefix: day boundaries anchor to startedAt, so "last night" would be
// false for most players.
function newsFor(todayLog, state, day) {
  if (!todayLog.length) return day === 1 ? 'A fresh start. Nothing to report.' : 'A quiet day. Nothing to report.'
  const { type, index } = todayLog[0]
  const pot = index >= 0 ? state.pots[index] : null
  const where = pot && pot.species ? `the ${pot.species} in pot ${index + 1}` : 'the garden'
  const lines = {
    aphids: `Aphids have found ${where}.`,
    wind: `A gust has knocked over ${where}.`,
    slug: `Something has been chewing ${where}.`,
    mildew: `There's a white dust on ${where}.`,
    crow: `A crow has been at the seedheads in pot ${index + 1}.`,
    squirrel: `A squirrel has dug up the sprout in pot ${index + 1}.`,
    heat: "It's been hot. Everything is thirsty.",
    frost: 'There is frost on the garden.',
    rain: 'It rained. Everything got a good drink.',
    butterfly: `A butterfly spent the day on ${where}.`,
    ladybug: `A ladybug has cleared the aphids from pot ${index + 1}.`,
    gift: 'A neighbour left you 80 coins.',
    sun: 'Perfect sun. Everything grew a little extra.',
    rainbow: 'There was a rainbow over the garden.',
    bird: `A bird sat on ${where}.`
  }
  return lines[type] || 'A quiet day. Nothing to report.'
}

function grantText(state, now) {
  const { raw } = dayFor(state, now)
  if (raw > DAYS) return 'season over'
  if (raw === DAYS) return 'last day'
  const nextBoundary = state.startedAt + raw * DAY_MS
  const hours = Math.max(0, Math.round((nextBoundary - now) / (60 * 60 * 1000)))
  return `+${DAILY_GRANT} in ${hours}h`
}

// ---------------------------------------------------------------- moves

const bad = (message) => { throw new Error(message) }

function potIndex(token, state) {
  const n = Number.parseInt(token, 10)
  if (!Number.isInteger(n) || n < 1 || n > MAX_POTS) bad('Pick a pot from 1 to 8.')
  if (n > state.pots.length) bad(`You haven't bought pot ${n} yet. Type "pot" to buy the next one.`)
  return n - 1
}

export function applyMove(state, seat, move, now = Date.now()) {
  const raw = String(move || '').trim().toLowerCase()
  if (!raw) return state // an empty submit is a harmless refresh, not an error

  const [verb, ...args] = raw.split(/\s+/)
  const view = snapshot(state, now)
  const next = clone(state)

  // Navigation is state: the engine has no concept of screens.
  if (/^\d+$/.test(verb)) { next.view = `pot:${potIndex(verb, state)}`; return next }
  if (['garden', 'shop', 'harvest', 'help'].includes(verb)) { next.view = verb; return next }
  if (verb === 'open') { next.view = `pot:${potIndex(args[0], state)}`; return next }

  // Playtest only: pull the start time back a day so the week can be watched in
  // minutes. Unreachable in a shipped build because DAY_MS is a full day.
  if (verb === 'skip') {
    if (!DEV) bad('Time passes on its own here.')
    next.startedAt -= DAY_MS
    return next
  }

  if (verb === 'newseason') {
    if (!view.over) bad('The season is still going. It ends on day 7.')
    const reward = view.blooms >= 8 ? 0 : view.blooms >= 6 ? 50 : view.blooms >= 4 ? 100 : 150
    const fresh = initialState(Math.random, now)
    fresh.seasonNo = state.seasonNo + 1
    fresh.carriedIn = { coins: reward, cosmetic: null }
    fresh.background = state.background
    fresh.accessories = state.accessories
    return fresh
  }

  if (view.over) bad('The season is over. Type "newseason" to start again.')

  switch (verb) {
    case 'water': {
      if (view.wateredToday) return next // silent no-op
      next.wateredOnDay = [...next.wateredOnDay, view.day]
      return next
    }

    case 'plant': {
      const species = args[0]
      if (!FLOWER_NAMES.includes(species)) bad(`Choose one of: ${FLOWER_NAMES.join(', ')}.`)
      const index = potIndex(args[1], state)
      if (next.pots[index].species) bad(`Pot ${index + 1} already has something growing in it.`)
      const price = FLOWERS[species].price
      if (view.coins < price) bad(`A ${species} costs ${price}. You have ${view.coins}.`)
      next.spent += price
      next.pots[index].species = species
      next.pots[index].plantedDay = view.day
      next.view = 'garden'
      return next
    }

    case 'pot': {
      if (next.pots.length >= MAX_POTS) bad('The shelf is full — eight pots is all it holds.')
      if (view.coins < POT_PRICE) bad(`A pot costs ${POT_PRICE}. You have ${view.coins}.`)
      next.spent += POT_PRICE
      next.pots.push(emptyPot())
      return next
    }

    case 'cure': {
      const index = potIndex(args[0], state)
      const pot = view.pots[index]
      if (!pot.damage) bad(`Nothing is wrong with pot ${index + 1}.`)
      const price = CURES[pot.damage.type]
      if (view.coins < price) bad(`Treating that costs ${price}. You have ${view.coins}.`)
      next.spent += price
      next.cures = [...next.cures, { pot: index, day: pot.damage.day, curedDay: view.day }]
      return next
    }

    case 'mulch': {
      const index = potIndex(args[0], state)
      if (!next.pots[index].species) bad(`Pot ${index + 1} is empty.`)
      if (next.pots[index].mulched) bad(`Pot ${index + 1} is already mulched.`)
      if (view.coins < MULCH_PRICE) bad(`Mulch costs ${MULCH_PRICE}. You have ${view.coins}.`)
      next.spent += MULCH_PRICE
      next.pots[index].mulched = true
      return next
    }

    case 'guard': {
      const kind = args[0]
      if (!GUARDS[kind]) bad(`Choose one of: ${Object.keys(GUARDS).join(', ')}.`)
      const index = potIndex(args[1], state)
      if (Object.hasOwn(next.pots[index].guards, kind)) bad(`Pot ${index + 1} already has that.`)
      const price = GUARDS[kind].price
      if (view.coins < price) bad(`${GUARDS[kind].label} costs ${price}. You have ${view.coins}.`)
      next.spent += price
      next.pots[index].guards[kind] = view.day // guards protect from the next day on
      return next
    }

    case 'compost': {
      const index = potIndex(args[0], state)
      if (!next.pots[index].species) bad(`Pot ${index + 1} is already empty.`)
      // Guards and mulch belong to the pot, not the plant, so they survive.
      next.pots[index].species = null
      next.pots[index].plantedDay = 0
      next.cures = next.cures.filter((c) => c.pot !== index)
      next.view = 'garden'
      return next
    }

    case 'decor': {
      const id = args[0]
      if (!ACCESSORIES[id]) bad(`Choose one of: ${Object.keys(ACCESSORIES).join(', ')}.`)
      if (next.accessories.includes(id)) bad('You already have that one.')
      if (view.coins < ACCESSORIES[id]) bad(`That costs ${ACCESSORIES[id]}. You have ${view.coins}.`)
      next.spent += ACCESSORIES[id]
      next.accessories = [...next.accessories, id]
      return next
    }

    case 'bg': {
      const id = args[0]
      if (!BACKGROUNDS.includes(id)) bad(`Choose one of: ${BACKGROUNDS.join(', ')}.`)
      if (next.background === id) bad('That is already your background.')
      if (view.coins < BACKGROUND_PRICE) bad(`A background costs ${BACKGROUND_PRICE}. You have ${view.coins}.`)
      next.spent += BACKGROUND_PRICE
      next.background = id
      return next
    }

    case 'code': {
      if (view.day !== 1) bad('Codes can only be used on the first day of a season.')
      if (state.lastCode) bad('You have already used a code this season.')
      const phrase = args.join('')
      if (Object.hasOwn(CARRY_CODES, phrase)) {
        next.carriedIn = { coins: CARRY_CODES[phrase], cosmetic: null }
      } else if (Object.hasOwn(COSMETIC_CODES, phrase)) {
        const gift = COSMETIC_CODES[phrase]
        next.carriedIn = { coins: 0, cosmetic: gift.id }
        if (gift.kind === 'background') next.background = gift.id
        else next.accessories = [...next.accessories, gift.id]
      } else bad("That isn't a code I recognise.")
      next.lastCode = phrase
      return next
    }

    default:
      bad(`I don't know "${verb}". Type "help" to see what you can do.`)
  }
}

// ---------------------------------------------------------------- views

const stageGlyph = (pot) => {
  if (pot.empty) return pot.owned ? '+' : '📦'
  if (pot.wilting && !pot.bloomed) return '🥀'
  return ['', '🌰', '🌱', '🌿', pot.glyph, '🌾'][pot.stage]
}

const potStatus = (pot) => {
  if (!pot.owned) return `${POT_PRICE} coins`
  if (pot.empty) return 'empty'
  if (pot.damage) return `${pot.damage.type} !`
  if (pot.wilting) return pot.dryDays >= 2 ? 'wilting !' : 'drooping !'
  return ['', 'planted', 'sprout', 'bud', 'in bloom', 'gone to seed'][pot.stage]
}

// The wall: pure art plus a day counter. No coins, no forecast, no QR.
export function publicView(state, now = Date.now()) {
  const view = snapshot(state, now)
  return {
    day: view.day,
    days: DAYS,
    over: view.over,
    background: state.background,
    accessories: state.accessories,
    tier: view.over ? view.tier : null,
    pots: view.pots.map((pot) => ({
      index: pot.index,
      owned: pot.owned,
      empty: pot.empty,
      species: pot.empty ? null : pot.species,
      stage: pot.empty ? 0 : pot.stage,
      bloomed: Boolean(pot.bloomed),
      // Wilt is a transform on the wall, not a separate sprite.
      droop: pot.empty ? 0 : Math.min(2, pot.dryDays) * 9,
      damage: pot.damage ? pot.damage.type : null
    }))
  }
}

export function privateView(state, seat, now = Date.now()) {
  const view = snapshot(state, now)
  const header = [
    ['Day', `${view.day} / ${DAYS}`, `💰 ${view.coins}`, view.grantIn],
    [view.forecast, '', '', ''],
    [view.news, '', '', '']
  ]
  const shelf = view.pots.map((pot) => [
    String(pot.index + 1), stageGlyph(pot),
    pot.empty ? (pot.owned ? 'empty pot' : 'shelf slot') : pot.species,
    potStatus(pot)
  ])

  let body
  if (view.over || state.view === 'harvest') {
    body = [
      [view.tier, '', '', ''],
      [`${view.blooms}`, 'in bloom', '', ''],
      [`${view.seeded}`, 'gone to seed', '', ''],
      [`${view.streak}`, 'days watered', '', ''],
      [view.over ? 'Type "newseason" to begin again.' : 'The season ends on day 7.', '', '', '']
    ]
  } else if (state.view === 'shop') {
    body = FLOWER_NAMES.map((name) => [
      FLOWERS[name].glyph, name, `💰 ${FLOWERS[name].price}`, `plant ${name} <pot>`
    ]).concat([
      ['+', 'extra pot', `💰 ${POT_PRICE}`, 'pot'],
      ['🍂', 'mulch', `💰 ${MULCH_PRICE}`, 'mulch <pot>'],
      ...Object.entries(GUARDS).map(([id, g]) => ['🛡️', g.label, `💰 ${g.price}`, `guard ${id} <pot>`]),
      ['🖼️', 'background', `💰 ${BACKGROUND_PRICE}`, 'bg <name>']
    ])
  } else if (state.view.startsWith('pot:')) {
    const pot = view.pots[Number(state.view.slice(4))]
    body = pot.empty
      ? [[`Pot ${pot.index + 1}`, 'is empty', '', `plant <flower> ${pot.index + 1}`]]
      : [
          [String(pot.index + 1), stageGlyph(pot), pot.species, potStatus(pot)],
          ['planted', `day ${pot.plantedDay}`, pot.mulched ? 'mulched' : 'not mulched', ''],
          ['neighbours', rowMates(pot.index).map((i) => i + 1).join(' and ') || 'none', '', ''],
          ...(pot.damage ? [['treat', `💰 ${CURES[pot.damage.type]}`, `cure ${pot.index + 1}`, '']] : []),
          ...(pot.wilting && !pot.bloomed ? [['needs water', '', 'water', '']] : [])
        ]
  } else if (state.view === 'help') {
    body = [
      ['Water every day. It is free and waters everything.', '', '', ''],
      ['Plants only grow on days they were watered.', '', '', ''],
      ['Nothing ever dies. Everything can be fixed.', '', '', ''],
      ['Marigolds look after the pots either side of them.', '', '', ''],
      ['water', 'garden', 'shop', 'harvest'],
      ['plant <flower> <pot>', 'pot', 'cure <pot>', 'mulch <pot>'],
      ['guard <item> <pot>', 'compost <pot>', 'decor <name>', 'bg <name>']
    ]
  } else {
    body = shelf
  }

  return { you: 'the gardener', rows: [...header, ...body] }
}

// Declarative buttons for the proposed controls() extension. Engines without
// support ignore this export; the strings are what a player would type anyway.
export function controls(view, seat, state, now = Date.now()) {
  if (!state) return []
  const snap = snapshot(state, now)
  const dev = DEV ? [{ label: '⏭️ Skip a day', move: 'skip', wide: true }] : []
  if (snap.over) return [{ label: '🌱 Start a new season', move: 'newseason', wide: true }, ...dev]
  return [
    { label: '💧 Water everything', move: 'water', wide: true, disabled: snap.wateredToday },
    ...snap.pots.map((pot) => ({
      label: `${pot.index + 1} ${stageGlyph(pot)}${pot.needsYou ? '!' : ''}`,
      move: `open ${pot.index + 1}`,
      group: 'pots'
    })),
    { label: '💰 Shop', move: 'shop', wide: true },
    { label: '📖 How to play', move: 'help' },
    ...dev
  ]
}
