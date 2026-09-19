import { decide, rank } from './decide.ts'
import { QUESTIONS, buildState } from './questions.ts'
import type {
  InterestSource,
  Bookmark,
  BookmarkSource,
  JevAsker,
  Sink,
  Thresholds,
  Verdict,
} from './types.ts'

export type RunOptions = {
  bookmarks: BookmarkSource
  interests: InterestSource
  jev: JevAsker
  sink: Sink
  thresholds: Thresholds
  /** Passed through to `bookmarks.fetch`. */
  limit?: number
  /** Parallel Jev calls. Values below 1 are treated as 1. @default 10 */
  concurrency?: number
  /** Called for each bookmark whose judgment failed; the run continues without it. */
  onError?: (bookmark: Bookmark, err: unknown) => void
}

export type RunResult = {
  /** Ranked; the same array the sink received. */
  verdicts: Verdict[]
  failed: number
  usage: { input_tokens: number; output_tokens: number }
  /**
   * Set when `bookmarks.fetch` threw mid-run. Verdicts judged before that point
   * were still ranked and emitted.
   */
  sourceError?: unknown
}

/**
 * Loads the digest, judges every bookmark with bounded parallelism, ranks, and
 * emits once. All I/O arrives through `opts`; nothing here touches the network
 * or filesystem directly. Rejects only if `interests.load()` or `sink.emit()`
 * rejects — per-bookmark and source failures are reported in the result instead.
 */
export async function run(opts: RunOptions): Promise<RunResult> {
  const interests = await opts.interests.load()
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 10) || 1)

  const verdicts: Verdict[] = []
  const usage = { input_tokens: 0, output_tokens: 0 }
  let failed = 0

  const judge = async (bookmark: Bookmark) => {
    try {
      const res = await opts.jev.ask(buildState(interests, bookmark), QUESTIONS)
      usage.input_tokens += res.usage?.input_tokens ?? 0
      usage.output_tokens += res.usage?.output_tokens ?? 0
      verdicts.push(decide(bookmark, res.answers, opts.thresholds))
    } catch (err) {
      failed++
      opts.onError?.(bookmark, err)
    }
  }

  const sourceError = await mapConcurrent(opts.bookmarks.fetch({ limit: opts.limit }), concurrency, judge)

  const ranked = rank(verdicts)
  await opts.sink.emit(ranked)
  const result: RunResult = { verdicts: ranked, failed, usage }
  if (sourceError !== undefined) result.sourceError = sourceError
  return result
}

// Pulls the next bookmark only when a worker frees up, so the source is never read
// further ahead than needed. If iteration throws, the error is returned rather
// than thrown so in-flight work can finish; this relies on async generators
// reporting `done` to every caller after they have thrown once.
async function mapConcurrent<T>(
  source: AsyncIterable<T>,
  limit: number,
  fn: (t: T) => Promise<void>,
): Promise<unknown> {
  const iterator = source[Symbol.asyncIterator]()
  let sourceError: unknown
  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      let next: IteratorResult<T>
      try {
        next = await iterator.next()
      } catch (err) {
        sourceError = err
        return
      }
      if (next.done) return
      await fn(next.value)
    }
  })
  await Promise.all(workers)
  return sourceError
}
