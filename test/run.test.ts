import { describe, expect, it } from 'vitest'
import { QUESTIONS } from '../src/questions.ts'
import { run } from '../src/run.ts'
import { createJsonlSink } from '../src/sinks/jsonl.ts'
import { createStdoutSink } from '../src/sinks/stdout.ts'
import type { Bookmark, BookmarkSource, JevAnswers, JevAsker, JevResponse, RecentWork, Sink, Verdict } from '../src/types.ts'
import fixture from './fixtures/jev-response.json' with { type: 'json' }

const bookmark = (n: number): Bookmark => ({
  id: `raindrop:${n}`,
  source: 'raindrop',
  url: `https://example.com/${n}`,
  title: `Article ${n}`,
  savedAt: '2026-09-10T00:00:00.000Z',
})

const source = (bookmarks: Bookmark[]): BookmarkSource => ({
  name: 'stub',
  async *fetch({ limit }) {
    for (const it of bookmarks.slice(0, limit)) yield it
  },
})

const recentWork: RecentWork = {
  days: 7,
  projects: [{ name: 'org/app', branches: ['main'], sessions: 1, titles: [], prompts: ['Working on a Compose list screen'] }],
}
const interests = { name: 'stub', load: async () => recentWork }

// Answers distance = 2 - 0.8n, effect = 1: n=0 → helps (2.0), n=1 → related (1.2), n=2 → skip (0.4).
const jevByTitle = (fail: number[] = []): JevAsker & { states: unknown[]; inFlight: number; peak: number } => {
  const asker = {
    states: [] as unknown[],
    inFlight: 0,
    peak: 0,
    async ask(state: unknown, questions: unknown): Promise<JevResponse> {
      asker.inFlight++
      asker.peak = Math.max(asker.peak, asker.inFlight)
      await new Promise((r) => setTimeout(r, 1))
      asker.inFlight--
      expect(questions).toBe(QUESTIONS)
      asker.states.push(state)
      const n = Number(/Article (\d+)/.exec((state as { article: { title: string } }).article.title)![1])
      if (fail.includes(n)) throw new Error(`boom ${n}`)
      const scored = (s: number) => ({ type: 'score' as const, score: s, confidence: 1, legend: {}, probabilities: {} })
      const answers: JevAnswers = { ...(fixture.answers as JevAnswers), distance: scored(2 - 0.8 * n), effect: scored(1) }
      return { model: 'jev-1.13.0', answers, usage: { input_tokens: 100, output_tokens: 10 } }
    },
  }
  return asker
}

const capture = (): Sink & { got: Verdict[] } => {
  const sink = {
    got: [] as Verdict[],
    async emit(v: Verdict[]) {
      sink.got = v
    },
  }
  return sink
}

describe('run', () => {
  it('judges every bookmark, ranks, and emits once', async () => {
    const sink = capture()
    const jev = jevByTitle()
    const result = await run({
      bookmarks: source([bookmark(2), bookmark(0), bookmark(1)]),
      interests,
      jev,
      sink
    })
    expect(sink.got.map((v) => v.bookmark.id)).toEqual(['raindrop:0', 'raindrop:1', 'raindrop:2'])
    expect(sink.got.map((v) => v.decision)).toEqual(['helps', 'related', 'skip'])
    expect(sink.got.map((v) => v.model)).toEqual(['jev-1.13.0', 'jev-1.13.0', 'jev-1.13.0'])
    expect(result.usage).toEqual({ input_tokens: 300, output_tokens: 30 })
    expect(result.failed).toBe(0)
  })

  it('does not judge a bookmark the prompts already refer to, and emits it as consulted', async () => {
    const sink = capture()
    const jev = jevByTitle()
    const seen = { ...bookmark(1), url: 'https://example.com/seen' }
    const work: RecentWork = { ...recentWork, projects: [{ ...recentWork.projects[0]!, prompts: ['look at https://example.com/seen/ first'] }] }
    await run({
      bookmarks: source([bookmark(0), seen]),
      interests: { name: 'stub', load: async () => work },
      jev,
      sink
    })
    expect(jev.states).toHaveLength(1)
    expect(sink.got.map((v) => [v.bookmark.id, v.decision])).toEqual([
      ['raindrop:0', 'helps'],
      ['raindrop:1', 'consulted'],
    ])
    expect(sink.got[1]).toEqual({ bookmark: seen, answers: {}, decision: 'consulted' })
  })

  it('builds state from recent work and the bookmark only', async () => {
    const jev = jevByTitle()
    await run({
      bookmarks: source([{ ...bookmark(0), note: 'n', tags: ['t'], highlights: ['h'] }]),
      interests,
      jev,
      sink: capture()
    })
    expect(jev.states[0]).toEqual({
      recent_work: recentWork,
      article: { title: 'Article 0', note: 'n', tags: ['t'], highlights: ['h'] },
    })
  })

  it('passes limit to the source', async () => {
    const jev = jevByTitle()
    await run({ bookmarks: source([bookmark(0), bookmark(1), bookmark(2)]), interests, jev, sink: capture(), limit: 2 })
    expect(jev.states).toHaveLength(2)
  })

  it('continues past failed judgments and reports them', async () => {
    const errors: string[] = []
    const sink = capture()
    const result = await run({
      bookmarks: source([bookmark(0), bookmark(1), bookmark(2)]),
      interests,
      jev: jevByTitle([1]),
      sink,
      onError: (it, err) => errors.push(`${it.id}:${(err as Error).message}`),
    })
    expect(result.failed).toBe(1)
    expect(errors).toEqual(['raindrop:1:boom 1'])
    expect(sink.got.map((v) => v.bookmark.id)).toEqual(['raindrop:0', 'raindrop:2'])
  })

  it('emits what was judged when the source fails mid-run', async () => {
    const sink = capture()
    const failing: BookmarkSource = {
      name: 'stub',
      async *fetch() {
        yield bookmark(0)
        yield bookmark(1)
        throw new Error('Raindrop HTTP 500: page 1')
      },
    }
    const result = await run({ bookmarks: failing, interests, jev: jevByTitle(), sink })
    expect(sink.got.map((v) => v.bookmark.id)).toEqual(['raindrop:0', 'raindrop:1'])
    expect((result.sourceError as Error).message).toBe('Raindrop HTTP 500: page 1')
  })

  it('never spawns zero workers', async () => {
    const jev = jevByTitle()
    await run({ bookmarks: source([bookmark(0)]), interests, jev, sink: capture(), concurrency: 0 })
    expect(jev.states).toHaveLength(1)
  })

  it('bounds concurrency', async () => {
    const jev = jevByTitle()
    await run({
      bookmarks: source(Array.from({ length: 12 }, (_, i) => bookmark(i))),
      interests,
      jev,
      sink: capture(),
      concurrency: 3,
    })
    expect(jev.peak).toBe(3)
    expect(jev.states).toHaveLength(12)
  })
})

describe('sinks', () => {
  const writer = () => {
    const w = { text: '', write: (s: string) => (w.text += s) }
    return w
  }
  const v = (n: number, decision: Verdict['decision']): Verdict => ({
    bookmark: bookmark(n),
    answers: fixture.answers as JevAnswers,
    model: fixture.model,
    decision,
  })

  it('jsonl writes one full verdict per line', async () => {
    const w = writer()
    await createJsonlSink(w).emit([v(0, 'helps'), v(1, 'skip')])
    const lines = w.text.trimEnd().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]!)).toEqual(v(1, 'skip'))
  })

  it('stdout prints helps and related under their headings, capped by top per section, with a depth label', async () => {
    const w = writer()
    await createStdoutSink(w, { top: 1 }).emit([v(0, 'helps'), v(1, 'helps'), v(2, 'related'), v(3, 'skip'), v(4, 'consulted')])
    expect(w.text).toBe(
      [
        'Helps with what you are doing now',
        '',
        'Article 0',
        '  https://example.com/0',
        '  a sitting',
        '',
        'Related to what you are doing now',
        '',
        'Article 2',
        '  https://example.com/2',
        '  a sitting',
        '',
        '',
      ].join('\n'),
    )
  })

  it('stdout leaves out an empty section', async () => {
    const w = writer()
    await createStdoutSink(w).emit([v(0, 'related')])
    expect(w.text).not.toContain('Helps')
    expect(w.text).toContain('Related to what you are doing now')
  })

  it('stdout says so when nothing is shown', async () => {
    const w = writer()
    await createStdoutSink(w).emit([v(0, 'skip'), v(1, 'consulted')])
    expect(w.text).toBe('nothing worth cashing in today\n')
  })
})
