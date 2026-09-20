import { describe, expect, it } from 'vitest'
import { consulted, decide, rank } from '../src/decide.ts'
import type { Bookmark, JevAnswers, RecentWork, Verdict } from '../src/types.ts'

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

const res = (answers: JevAnswers) => ({ model: 'jev-1.13.0', answers })

describe('decide', () => {
  it('surfaces when relevant is exactly at the threshold', () => {
    expect(decide(bookmark, res(answers(0.5)), { relevant: 0.5 }).decision).toBe('surface')
  })

  it('skips just below the threshold', () => {
    expect(decide(bookmark, res(answers(0.4999)), { relevant: 0.5 }).decision).toBe('skip')
  })

  it('treats 0.5 as "no idea", so a strict threshold skips it', () => {
    expect(decide(bookmark, res(answers(0.5)), { relevant: 0.7 }).decision).toBe('skip')
  })

  it('ignores the other questions for the decision', () => {
    const v = decide(
      bookmark,
      res(
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
      ),
      { relevant: 0.5 },
    )
    expect(v.decision).toBe('surface')
  })

  it('skips when relevant is missing', () => {
    expect(decide(bookmark, res({}), { relevant: 0.0 }).decision).toBe('skip')
  })

  it('skips when relevant has the wrong type', () => {
    const wrong: JevAnswers = {
      relevant: { type: 'choice', choice: 'yes', confidence: 1, probabilities: { yes: 1 } },
    }
    expect(decide(bookmark, res(wrong), { relevant: 0.0 }).decision).toBe('skip')
  })

  it('keeps every answer on the verdict untouched and records the model', () => {
    const a = answers(0.8, { some_future_question: { type: 'noul', noul: 0.3 } })
    const v = decide(bookmark, { model: 'jev-9.9.9', answers: a }, { relevant: 0.5 })
    expect(v.answers).toBe(a)
    expect(v.model).toBe('jev-9.9.9')
  })
})

describe('rank', () => {
  const v = (id: string, relevant: number, actionable?: number): Verdict => ({
    bookmark: { ...bookmark, id },
    answers: answers(relevant, actionable === undefined ? {} : { actionable: { type: 'noul', noul: actionable } }),
    model: 'jev-1.13.0',
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
