import { describe, expect, it } from 'vitest'
import { consulted, decide, rank } from '../src/decide.ts'
import type { Bookmark, JevAnswer, JevAnswers, RecentWork, Verdict } from '../src/types.ts'

const bookmark: Bookmark = {
  id: 'raindrop:1',
  source: 'raindrop',
  url: 'https://example.com/a',
  title: 'A',
  savedAt: '2026-09-10T00:00:00.000Z',
}

/** A Score answer from its per-level probabilities; `score` is their mean, as Jev computes it. */
const score = (...p: number[]): JevAnswer => ({
  type: 'score',
  score: p.reduce((sum, x, i) => sum + x * i, 0),
  confidence: 1,
  legend: {},
  probabilities: Object.fromEntries(p.map((x, i) => [String(i), x])),
})
const answers = (distance: JevAnswer, effect: JevAnswer): JevAnswers => ({ distance, effect })
const res = (answers: JevAnswers) => ({ model: 'jev-1.13.0', answers })

describe('decide', () => {
  it('reads the outcome table by the most likely level of distance and effect', () => {
    expect(decide(bookmark, res(answers(score(0, 0.1, 0.9), score(0.2, 0.7, 0.1)))).decision).toBe('helps')
    expect(decide(bookmark, res(answers(score(0, 0.6, 0.4), score(0.2, 0.7, 0.1)))).decision).toBe('related')
    expect(decide(bookmark, res(answers(score(0, 0.6, 0.4), score(0.1, 0.1, 0.8)))).decision).toBe('related')
    expect(decide(bookmark, res(answers(score(0, 0.1, 0.9), score(0.8, 0.2, 0)))).decision).toBe('skip')
    expect(decide(bookmark, res(answers(score(0.9, 0.1, 0), score(0.1, 0.1, 0.8)))).decision).toBe('skip')
  })

  it('does not let an even split promote an article: the mean would round up, the most likely level does not', () => {
    const torn = score(0.01, 0.51, 0.48) // mean 1.47; a run at 0.49/0.51 would round to 2
    expect(decide(bookmark, res(answers(torn, score(0.3, 0.6, 0.1)))).decision).toBe('related')
    expect(decide(bookmark, res(answers(score(0, 0.5, 0.5), score(0.3, 0.6, 0.1)))).decision).toBe('related')
  })

  it('skips when a deciding answer is missing, not a score, or lacks a level probability', () => {
    expect(decide(bookmark, res({ distance: score(0, 0.1, 0.9) })).decision).toBe('skip')
    expect(decide(bookmark, res({ ...answers(score(0, 0.1, 0.9), score(0, 0.1, 0.9)), effect: { type: 'noul', noul: 1 } })).decision).toBe('skip')
    expect(decide(bookmark, res(answers(score(0, 0.1, 0.9), score(0.2, 0.8)))).decision).toBe('skip')
  })

  it('keeps every answer on the verdict untouched, records the model and the levels it read', () => {
    const a = {
      ...answers(score(0, 0.1, 0.9), score(0.2, 0.7, 0.1)),
      depth: score(0.4, 0.4, 0.1, 0.1),
      some_future_question: { type: 'noul', noul: 0.3 } as JevAnswer,
    }
    const v = decide(bookmark, { model: 'jev-9.9.9', answers: a })
    expect(v.answers).toBe(a)
    expect(v.model).toBe('jev-9.9.9')
    // depth: a tie between levels 0 and 1 goes to the lower one
    expect(v.levels).toEqual({ distance: 2, effect: 1, depth: 0 })
  })
})

describe('rank', () => {
  const v = (id: string, distance: JevAnswer, effect: JevAnswer): Verdict => decide({ ...bookmark, id }, res(answers(distance, effect)))

  it('orders by distance level, then effect level, then the mean scores', () => {
    const out = rank([
      v('a', score(0, 0.6, 0.4), score(0.1, 0.1, 0.8)), // levels 1/2, mean 1.4
      v('b', score(0.3, 0, 0.7), score(0.3, 0.6, 0.1)), // levels 2/1, mean 1.4
      v('c', score(0, 0.1, 0.9), score(0.3, 0.6, 0.1)), // levels 2/1, mean 1.9
      v('d', score(0.9, 0.1, 0), score(0.1, 0.1, 0.8)), // levels 0/2
    ])
    expect(out.map((x) => x.bookmark.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('puts a verdict without levels last and does not mutate the input', () => {
    const consultedVerdict: Verdict = { bookmark: { ...bookmark, id: 'x' }, answers: {}, decision: 'consulted' }
    const input = [consultedVerdict, v('a', score(0.9, 0.1, 0), score(0.9, 0.1, 0))]
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

  it('matches whole URLs pasted before punctuation', () => {
    expect(consulted(work('読んで: https://docs.example.com/cookbooks/a。あとで'), at('https://docs.example.com/cookbooks/a'))).toBe(true)
    expect(consulted(work('see (https://docs.example.com/cookbooks/a), then'), at('https://docs.example.com/cookbooks/a'))).toBe(true)
    expect(consulted(work('see https://docs.example.com/cookbooks/a.'), at('https://docs.example.com/cookbooks/a'))).toBe(true)
  })

  it('is false for a different page, a page under the bookmark, a longer host, or no URL at all', () => {
    const w = work('read https://docs.example.com/cookbooks/a/ please')
    expect(consulted(w, at('https://docs.example.com/cookbooks/b'))).toBe(false)
    expect(consulted(w, at('https://docs.example.com/cookbooks'))).toBe(false)
    expect(consulted(w, at('https://docs.example.com'))).toBe(false)
    expect(consulted(work('read https://xdocs.example.com/cookbooks/a'), at('https://docs.example.com/cookbooks/a'))).toBe(false)
    expect(consulted(work('read https://docs.example.com/cookbooks/abc'), at('https://docs.example.com/cookbooks/a'))).toBe(false)
    expect(consulted(work('nothing here'), at('https://docs.example.com/cookbooks/a'))).toBe(false)
  })
})
