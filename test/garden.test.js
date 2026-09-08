import { describe, expect, it } from 'vitest'
import {
  DAY_MS, DEV, meta, initialState, applyMove, publicView, privateView, snapshot, dayFor
} from '../src/games/garden.js'

// A fixed clock and a fixed RNG make every week reproducible.
const T0 = 1756100000000
const at = (day, hours = 1) => T0 + (day - 1) * DAY_MS + hours * 60 * 60 * 1000

function seeded(n = 1) {
  let a = n
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fresh = (n = 1) => initialState(seeded(n), T0)
// A week with no weather at all, for testing growth in isolation.
const calm = (n = 1) => ({ ...fresh(n), events: [] })
// A week containing exactly one chosen hazard, so damage can be tested in isolation.
const withHazard = (type, day = 3, n = 1) => ({ ...fresh(n), events: [{ day, kind: 'bad', type }] })

// Play a move and assert the original object was not touched.
function play(state, move, now) {
  const before = JSON.stringify(state)
  const after = applyMove(state, 1, move, now)
  expect(JSON.stringify(state)).toBe(before)
  return after
}

describe('meta', () => {
  it('is a single-seat game', () => {
    expect(meta.seats).toBe(1)
    expect(meta.name.length).toBeLessThanOrEqual(35)
  })
})

describe('the clock', () => {
  it('starts on day 1 and advances every 24h', () => {
    const s = fresh()
    expect(dayFor(s, T0).day).toBe(1)
    expect(dayFor(s, at(3)).day).toBe(3)
    expect(dayFor(s, at(7)).day).toBe(7)
  })

  it('reports the season over after day 7', () => {
    const s = fresh()
    expect(dayFor(s, at(7, 23)).over).toBe(false)
    expect(dayFor(s, at(8)).over).toBe(true)
  })

  it('advances without the player doing anything', () => {
    const s = fresh()
    expect(snapshot(s, at(1)).coins).toBe(500)
    expect(snapshot(s, at(4)).coins).toBe(500 + 200 * 3)
  })
})

describe('the event schedule', () => {
  it('is pre-rolled and immutable across reads', () => {
    const s = fresh(7)
    const first = JSON.stringify(s.events)
    snapshot(s, at(3))
    snapshot(s, at(6))
    expect(JSON.stringify(s.events)).toBe(first)
  })

  it('never puts a hazard on day 1 or day 7', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = fresh(seed)
      const hazardDays = s.events.filter((e) => e.kind === 'bad').map((e) => e.day)
      expect(hazardDays).not.toContain(1)
      expect(hazardDays).not.toContain(7)
    }
  })

  it('honours the pre-roll guarantees', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const events = fresh(seed).events
      const good = events.filter((e) => e.kind === 'good').length
      const bad = events.filter((e) => e.kind === 'bad').length
      expect(good).toBeGreaterThanOrEqual(2)
      expect(bad).toBeLessThanOrEqual(3)
      const backToBackEarly = events.some(
        (e, i) => i > 0 && e.kind === 'bad' && events[i - 1].kind === 'bad' && e.day < 5
      )
      expect(backToBackEarly).toBe(false)
    }
  })

  it('produces the same week from the same seed', () => {
    expect(JSON.stringify(fresh(42).events)).toBe(JSON.stringify(fresh(42).events))
  })
})

describe('planting and growth', () => {
  it('grows one stage per watered day', () => {
    let s = calm(3)
    s = play(s, 'plant tulip 1', at(1))
    for (let d = 1; d <= 4; d++) s = play(s, 'water', at(d))
    expect(snapshot(s, at(4)).pots[0].stage).toBeGreaterThanOrEqual(4)
    expect(snapshot(s, at(4)).pots[0].bloomed).toBe(true)
  })

  it('does not grow on days that were missed', () => {
    let s = calm(3)
    s = play(s, 'plant tulip 1', at(1))
    s = play(s, 'water', at(1))
    const stage = snapshot(s, at(5)).pots[0].stage
    expect(stage).toBeLessThan(4)
  })

  it('still advances the calendar when the player does nothing', () => {
    const s = fresh(3)
    expect(snapshot(s, at(6)).day).toBe(6)
  })

  it('droops after one dry day and wilts after two', () => {
    let s = calm(3)
    s = play(s, 'plant tulip 1', at(1))
    s = play(s, 'water', at(1))
    expect(snapshot(s, at(2)).pots[0].dryDays).toBe(1)
    expect(snapshot(s, at(3)).pots[0].dryDays).toBe(2)
    expect(snapshot(s, at(3)).pots[0].wilting).toBe(true)
  })

  it('recovers the moment it is watered again', () => {
    let s = calm(3)
    s = play(s, 'plant tulip 1', at(1))
    s = play(s, 'water', at(1))
    s = play(s, 'water', at(4))
    expect(snapshot(s, at(4)).pots[0].wilting).toBe(false)
  })

  it('lets mulch carry a pot through a single missed day', () => {
    let plain = calm(3)
    plain = play(plain, 'plant tulip 1', at(1))
    let mulched = play(plain, 'mulch 1', at(1))
    for (const d of [1, 3]) {
      plain = play(plain, 'water', at(d))
      mulched = play(mulched, 'water', at(d))
    }
    expect(snapshot(mulched, at(4)).pots[0].stage)
      .toBeGreaterThan(snapshot(plain, at(4)).pots[0].stage)
  })
})

describe('money', () => {
  it('charges for a flower and refuses when short', () => {
    let s = fresh(3)
    s = play(s, 'plant rose 1', at(1))
    expect(snapshot(s, at(1)).coins).toBe(500 - 120)
    s = play(s, 'plant hydrangea 2', at(1))
    s = play(s, 'plant hydrangea 3', at(1))
    expect(() => applyMove(s, 1, 'plant hydrangea 1', at(1))).toThrow()
  })

  it('caps the shelf at eight pots', () => {
    let s = fresh(3)
    for (let i = 0; i < 5; i++) s = play(s, 'pot', at(5))
    expect(s.pots.length).toBe(8)
    expect(() => applyMove(s, 1, 'pot', at(5))).toThrow(/shelf is full/i)
  })
})

describe('moves', () => {
  it('treats an empty submit as a no-op', () => {
    const s = fresh()
    expect(applyMove(s, 1, '', at(1))).toBe(s)
  })

  it('rejects an unknown verb with a helpful message', () => {
    expect(() => applyMove(fresh(), 1, 'frobnicate', at(1))).toThrow(/help/i)
  })

  it('waters only once a day', () => {
    let s = fresh()
    s = play(s, 'water', at(2))
    const again = play(s, 'water', at(2))
    expect(again.wateredOnDay).toEqual([2])
  })

  it('navigates by bare pot number', () => {
    const s = play(fresh(), '2', at(1))
    expect(s.view).toBe('pot:1')
  })

  it('refuses a pot the player has not bought', () => {
    expect(() => applyMove(fresh(), 1, '7', at(1))).toThrow(/bought/i)
  })

  it('keeps guards on the pot when a plant is composted', () => {
    let s = fresh(3)
    s = play(s, 'plant tulip 1', at(1))
    s = play(s, 'guard neem 1', at(1))
    s = play(s, 'compost 1', at(2))
    expect(s.pots[0].species).toBe(null)
    expect(s.pots[0].guards.neem).toBe(1) // guards belong to the pot, not the plant
  })
})

describe('carry-over codes', () => {
  it('accepts a known code on day 1', () => {
    const s = play(fresh(), 'code freshstart', at(1))
    expect(s.carriedIn.coins).toBe(150)
    expect(snapshot(s, at(1)).coins).toBe(650)
  })

  it('ignores spaces and capitals', () => {
    const s = play(fresh(), 'code Green Thumb', at(1))
    expect(s.carriedIn.coins).toBe(50)
  })

  it('grants a cosmetic instead of coins', () => {
    const s = play(fresh(), 'code japanesegarden', at(1))
    expect(s.background).toBe('japanese')
    expect(s.carriedIn.coins).toBe(0)
  })

  it('refuses after day 1, twice, or when unknown', () => {
    expect(() => applyMove(fresh(), 1, 'code freshstart', at(2))).toThrow(/first day/i)
    const used = play(fresh(), 'code freshstart', at(1))
    expect(() => applyMove(used, 1, 'code newsoil', at(1))).toThrow(/already/i)
    expect(() => applyMove(fresh(), 1, 'code hunter2', at(1))).toThrow(/recognise/i)
  })
})

describe('the end of a season', () => {
  it('never sets state.result, so the record stays playable', () => {
    const s = fresh()
    expect(s.result).toBe(null)
    expect(snapshot(s, at(9)).over).toBe(true)
    expect(applyMove(s, 1, 'newseason', at(9)).result).toBe(null)
  })

  it('refuses newseason before the week is up', () => {
    expect(() => applyMove(fresh(), 1, 'newseason', at(4))).toThrow(/still going/i)
  })

  it('rejects ordinary moves once the season is over', () => {
    expect(() => applyMove(fresh(), 1, 'water', at(9))).toThrow(/newseason/i)
  })

  it('carries more coins forward for a weaker garden', () => {
    const s = fresh(3)
    const after = applyMove(s, 1, 'newseason', at(9))
    expect(after.carriedIn.coins).toBe(150) // nothing planted at all
    expect(after.seasonNo).toBe(2)
    expect(after.startedAt).toBe(at(9))
  })
})

describe('views', () => {
  it('privateView returns the fields views.js requires', () => {
    const view = privateView(fresh(), 1, at(3))
    expect(typeof view.you).toBe('string')
    expect(Array.isArray(view.rows)).toBe(true)
    expect(view.rows.every((row) => Array.isArray(row))).toBe(true)
  })

  it('renders every screen without throwing', () => {
    let s = fresh(3)
    s = play(s, 'plant tulip 1', at(1))
    for (const screen of ['garden', 'shop', 'help', 'harvest', '1']) {
      const next = play(s, screen, at(3))
      expect(() => privateView(next, 1, at(3))).not.toThrow()
    }
  })

  it('puts no coins, no forecast and no QR on the wall', () => {
    const wall = publicView(fresh(3), at(3))
    const text = JSON.stringify(wall)
    expect(wall.coins).toBeUndefined()
    expect(text).not.toMatch(/muggy|coins|qr/i)
    expect(wall.day).toBe(3)
  })

  it('expresses wilt as a rotation, not a sprite', () => {
    let s = calm(3)
    s = play(s, 'plant tulip 1', at(1))
    s = play(s, 'water', at(1))
    expect(publicView(s, at(1)).pots[0].droop).toBe(0)
    expect(publicView(s, at(2)).pots[0].droop).toBe(9)
    expect(publicView(s, at(4)).pots[0].droop).toBe(18)
  })

  // The one that matters: two independent time calculations will drift, and the
  // one that drifts is the one nobody is looking at.
  it('never lets the wall disagree with the phone', () => {
    let s = fresh(11)
    s = play(s, 'plant sunflower 1', at(1))
    s = play(s, 'plant daisy 2', at(1))
    for (let d = 1; d <= 6; d++) s = play(s, 'water', at(d))
    for (let i = 0; i < 60; i++) {
      const now = T0 + Math.floor((i / 60) * 8 * DAY_MS)
      const wall = publicView(s, now)
      const phone = snapshot(s, now)
      expect(wall.day).toBe(phone.day)
      wall.pots.forEach((pot, index) => {
        expect(pot.stage).toBe(phone.pots[index].empty ? 0 : phone.pots[index].stage)
      })
    }
  })
})

describe('purity', () => {
  it('is deterministic for a fixed state and clock', () => {
    const s = fresh(5)
    expect(JSON.stringify(publicView(s, at(4)))).toBe(JSON.stringify(publicView(s, at(4))))
  })

  it('uses no forbidden tokens', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../src/games/garden.js', import.meta.url), 'utf8')
    for (const token of [
      'fetch(', 'env.', 'eval(', 'new Function', 'setTimeout', 'setInterval',
      'XMLHttpRequest', 'WebSocket', 'import('
    ]) {
      expect(src).not.toContain(token)
    }
  })
})


describe('the playtest skip', () => {
  it('is switched off in committed code', () => {
    expect(DAY_MS).toBe(24 * 60 * 60 * 1000)
    expect(DEV).toBe(false)
    expect(() => applyMove(fresh(), 1, 'skip', at(1))).toThrow(/on its own/i)
  })
})

describe('hazards landing', () => {
  const planted = (state, ...species) => {
    let s = state
    species.forEach((name, i) => { s = applyMove(s, 1, `plant ${name} ${i + 1}`, at(1)) })
    return s
  }

  it('damages a pot with no action from the player', () => {
    let s = planted(withHazard('aphids'), 'tulip')
    expect(snapshot(s, at(2)).pots[0].damage).toBe(null)
    const hit = snapshot(s, at(3)).pots[0]
    expect(hit.damage.type).toBe('aphids')
    expect(hit.damage.day).toBe(3)
  })

  it('shows the damage on the wall too', () => {
    const s = planted(withHazard('aphids'), 'tulip')
    expect(publicView(s, at(3)).pots[0].damage).toBe('aphids')
  })

  it('stops the plant growing until it is treated', () => {
    let s = planted(withHazard('aphids'), 'tulip')
    for (let d = 1; d <= 6; d++) s = applyMove(s, 1, 'water', at(d))
    const neglected = snapshot(s, at(6)).pots[0].stage
    const treated = applyMove(s, 1, 'cure 1', at(4))
    expect(snapshot(treated, at(6)).pots[0].stage).toBeGreaterThan(neglected)
  })

  it('charges for the cure and clears the damage', () => {
    let s = planted(withHazard('mildew'), 'tulip')
    const before = snapshot(s, at(3)).coins
    s = applyMove(s, 1, 'cure 1', at(3))
    expect(snapshot(s, at(3)).coins).toBe(before - 60)
    expect(snapshot(s, at(3)).pots[0].damage).toBe(null)
  })

  it('refuses to treat a healthy pot', () => {
    const s = planted(calm(), 'tulip')
    expect(() => applyMove(s, 1, 'cure 1', at(3))).toThrow(/nothing is wrong/i)
  })

  it('scales the number of pots hit with the size of the garden', () => {
    // A full shelf is only affordable by day 4, so the hazard lands on day 5.
    const small = planted(withHazard('aphids', 5), 'tulip', 'daisy')
    let big = withHazard('aphids', 5)
    for (let i = 0; i < 5; i++) big = applyMove(big, 1, 'pot', at(4))
    for (let i = 1; i <= 8; i++) big = applyMove(big, 1, `plant pansy ${i}`, at(4))
    expect(snapshot(small, at(5)).damaged).toBe(1)
    expect(snapshot(big, at(5)).damaged).toBe(2)
  })

  it('lets a guard block the hazard it was bought for', () => {
    let s = planted(withHazard('aphids'), 'tulip')
    s = applyMove(s, 1, 'guard neem 1', at(1))
    expect(snapshot(s, at(3)).pots[0].damage).toBe(null)
  })

  it('does not let a guard block a different hazard', () => {
    let s = planted(withHazard('mildew'), 'tulip')
    s = applyMove(s, 1, 'guard neem 1', at(1))
    expect(snapshot(s, at(3)).pots[0].damage.type).toBe('mildew')
  })

  it('lets a marigold protect the pot next to it', () => {
    const s = planted(withHazard('slug'), 'marigold', 'tulip')
    expect(snapshot(s, at(3)).pots[1].damage).toBe(null)
  })

  it('spreads mildew to a neighbour when left uncured', () => {
    const s = planted(withHazard('mildew', 2), 'tulip', 'daisy')
    expect(snapshot(s, at(2)).damaged).toBe(1)
    expect(snapshot(s, at(4)).damaged).toBe(2)
  })

  it('stops mildew spreading once it is treated', () => {
    let s = planted(withHazard('mildew', 2), 'tulip', 'daisy')
    s = applyMove(s, 1, 'cure 1', at(2))
    expect(snapshot(s, at(5)).damaged).toBe(0)
  })

  it('never spreads mildew across the two rows', () => {
    let s = withHazard('mildew', 4)
    for (let i = 0; i < 5; i++) s = applyMove(s, 1, 'pot', at(3))
    s = applyMove(s, 1, 'plant tulip 4', at(3)) // last pot of the top row
    s = applyMove(s, 1, 'plant daisy 5', at(3)) // first pot of the bottom row
    expect(snapshot(s, at(6)).pots[3].damage.type).toBe('mildew')
    expect(snapshot(s, at(6)).pots[4].damage).toBe(null)
  })

  it('names the pot in the news the day it happens', () => {
    const s = planted(withHazard('aphids'), 'tulip')
    expect(snapshot(s, at(3)).news).toMatch(/aphids.*tulip.*pot 1/i)
  })

  it('flags the pot for attention on the phone', () => {
    const s = planted(withHazard('aphids'), 'tulip')
    expect(snapshot(s, at(3)).pots[0].needsYou).toBe(true)
  })
})
