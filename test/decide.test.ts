import { describe, expect, it } from 'vitest'
import { consulted, decide, level, rank } from '../src/decide.ts'
import type { Bookmark, JevAnswer, JevAnswers, RecentWork, Verdict } from '../src/types.ts'

const bookmark: Bookmark = {
  id: 'raindrop:1',
  source: 'raindrop',
  url: 'https://example.com/a',
  title: 'A',
  savedAt: '2026-09-10T00:00:00.000Z',
}

const score = (s: number, top = 2): JevAnswer => ({
  type: 'score',
  score: s,
  confidence: 1,
  legend: {},
  probabilities: {},
})
const answers = (distance: number, effect: number): JevAnswers => ({ distance: score(distance), effect: score(effect) })
const res = (answers: JevAnswers) => ({ model: 'jev-1.13.0', answers })

describe('decide', () => {
  it('reads the outcome table by the nearest level of distance and effect', () => {
    expect(decide(bookmark, res(answers(2.0, 1.0))).decision).toBe('helps')
    expect(decide(bookmark, res(answers(1.6, 0.9))).decision).toBe('helps')
    expect(decide(bookmark, res(answers(1.4, 1.0))).decision).toBe('related')
    expect(decide(bookmark, res(answers(1.0, 2.0))).decision).toBe('related')
    expect(decide(bookmark, res(answers(2.0, 0.4))).decision).toBe('skip')
    expect(decide(bookmark, res(answers(0.4, 2.0))).decision).toBe('skip')
  })

  it('rounds halves up, as the cookbook does', () => {
    expect(decide(bookmark, res(answers(1.5, 0.5))).decision).toBe('helps')
  })

  it('skips when a deciding answer is missing or not a score', () => {
    expect(decide(bookmark, res({ distance: score(2) })).decision).toBe('skip')
    expect(decide(bookmark, res({ ...answers(2, 2), effect: { type: 'noul', noul: 1 } })).decision).toBe('skip')
  })

  it('keeps every answer on the verdict untouched and records the model', () => {
    const a = { ...answers(2, 1), some_future_question: { type: 'noul', noul: 0.3 } as JevAnswer }
    const v = decide(bookmark, { model: 'jev-9.9.9', answers: a })
    expect(v.answers).toBe(a)
    expect(v.model).toBe('jev-9.9.9')
  })
})

describe('level', () => {
  it('never exceeds the top level even if the score does', () => {
    expect(level({ depth: score(3.4) }, 'depth')).toBe(3)
    expect(level({ depth: score(0.49) }, 'depth')).toBe(0)
  })
})

describe('rank', () => {
  const v = (id: string, distance: number, effect: number): Verdict => ({
    bookmark: { ...bookmark, id },
    answers: answers(distance, effect),
    model: 'jev-1.13.0',
    decision: 'helps',
  })

  it('orders by distance descending, then effect descending', () => {
    const out = rank([v('a', 1.2, 2), v('b', 1.9, 0.5), v('c', 1.9, 1.5), v('d', 0.3, 0)])
    expect(out.map((x) => x.bookmark.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('puts a verdict without answers last and does not mutate the input', () => {
    const consultedVerdict: Verdict = { bookmark: { ...bookmark, id: 'x' }, answers: {}, decision: 'consulted' }
    const input = [consultedVerdict, v('a', 0.3, 0)]
    expect(rank(input).map((x) => x.bookmark.id)).toEqual(['a', 'x'])
    expect(input[0]!.bookmark.id).toBe('x')
  })
})

describe('consulted', () => {
  const work = (...prompts: string[]): RecentWork => ({
    days: 7,
    projects: [{ name: 'p', branches: [], sessions: 1, titles: [], prompts }],
  })
  const at = (url: string): Bookmark => ({ ...bookmark, url })

  it('is true when a prompt contains the URL, ignoring scheme, www, trailing slash and fragment', () => {
    const w = work('read https://docs.example.com/cookbooks/a/ and tell me', 'unrelated prompt text here')
    expect(consulted(w, at('https://docs.example.com/cookbooks/a'))).toBe(true)
    expect(consulted(w, at('http://www.docs.example.com/cookbooks/a/#setup'))).toBe(true)
  })

  it('is false for a different page on the same site or no URL at all', () => {
    const w = work('read https://docs.example.com/cookbooks/a/ please')
    expect(consulted(w, at('https://docs.example.com/cookbooks/b'))).toBe(false)
    expect(consulted(work('nothing here'), at('https://docs.example.com/cookbooks/a'))).toBe(false)
  })
})
