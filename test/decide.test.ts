import { describe, expect, it } from 'vitest'
import { decide, rank } from '../src/decide.ts'
import type { Bookmark, JevAnswers, Verdict } from '../src/types.ts'

const bookmark: Bookmark = {
  id: 'raindrop:1',
  source: 'raindrop',
  url: 'https://example.com/a',
  title: 'A',
  savedAt: '2026-09-10T00:00:00.000Z',
}

const answers = (relevant: number, extra: JevAnswers = {}): JevAnswers => ({
  relevant: { type: 'noul', noul: relevant },
  ...extra,
})

describe('decide', () => {
  it('surfaces when relevant is exactly at the threshold', () => {
    expect(decide(bookmark, answers(0.5), { relevant: 0.5 }).decision).toBe('surface')
  })

  it('skips just below the threshold', () => {
    expect(decide(bookmark, answers(0.4999), { relevant: 0.5 }).decision).toBe('skip')
  })

  it('treats 0.5 as "no idea", so a strict threshold skips it', () => {
    expect(decide(bookmark, answers(0.5), { relevant: 0.7 }).decision).toBe('skip')
  })

  it('ignores the other questions for the decision', () => {
    const v = decide(
      bookmark,
      answers(0.9, {
        some_future_question: { type: 'noul', noul: 0.99 },
        actionable: { type: 'noul', noul: 0.01 },
        depth: {
          type: 'score',
          score: 0.1,
          confidence: 0.1,
          legend: {},
          probabilities: { '0': 0.5, '1': 0.5 },
        },
      }),
      { relevant: 0.5 },
    )
    expect(v.decision).toBe('surface')
  })

  it('skips when relevant is missing', () => {
    expect(decide(bookmark, {}, { relevant: 0.0 }).decision).toBe('skip')
  })

  it('skips when relevant has the wrong type', () => {
    const wrong: JevAnswers = {
      relevant: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } },
    }
    expect(decide(bookmark, wrong, { relevant: 0.0 }).decision).toBe('skip')
  })

  it('keeps every answer on the verdict untouched', () => {
    const a = answers(0.8, { some_future_question: { type: 'noul', noul: 0.3 } })
    expect(decide(bookmark, a, { relevant: 0.5 }).answers).toBe(a)
  })
})

describe('rank', () => {
  const v = (id: string, relevant: number, actionable?: number): Verdict => ({
    bookmark: { ...bookmark, id },
    answers: answers(relevant, actionable === undefined ? {} : { actionable: { type: 'noul', noul: actionable } }),
    decision: 'surface',
  })

  it('orders by relevant descending', () => {
    const out = rank([v('a', 0.3), v('b', 0.9), v('c', 0.6)])
    expect(out.map((x) => x.bookmark.id)).toEqual(['b', 'c', 'a'])
  })

  it('breaks ties by actionable', () => {
    const out = rank([v('a', 0.8, 0.2), v('b', 0.8, 0.7), v('c', 0.8)])
    expect(out.map((x) => x.bookmark.id)).toEqual(['b', 'a', 'c'])
  })

  it('does not mutate the input', () => {
    const input = [v('a', 0.3), v('b', 0.9)]
    rank(input)
    expect(input.map((x) => x.bookmark.id)).toEqual(['a', 'b'])
  })
})
