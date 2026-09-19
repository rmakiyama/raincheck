import type { Sink, Verdict } from '../types.ts'
import type { Writer } from './jsonl.ts'

/**
 * Sink that prints only surfaced verdicts, in the order received, at most
 * `top` of them.
 */
export function createStdoutSink(out: Writer, opts: { top?: number } = {}): Sink {
  return {
    async emit(verdicts: Verdict[]): Promise<void> {
      const surfaced = verdicts.filter((v) => v.decision === 'surface')
      const shown = opts.top === undefined ? surfaced : surfaced.slice(0, opts.top)

      if (shown.length === 0) {
        out.write(`nothing worth cashing in today (${verdicts.length} judged)\n`)
        return
      }

      out.write(`${shown.length} of ${verdicts.length} worth cashing in today\n\n`)
      for (const v of shown) {
        out.write(`${v.bookmark.title}\n`)
        out.write(`  ${v.bookmark.url}\n`)
        out.write(`  ${signals(v)}\n\n`)
      }
    },
  }
}

// Raw probabilities, two decimals. Not scaled to percent: 0.5 on a noul means
// "no idea", and reading it as 50% invites the wrong interpretation.
function signals(v: Verdict): string {
  const parts: string[] = []
  for (const [id, a] of Object.entries(v.answers)) {
    if (a.type === 'noul') parts.push(`${id}=${a.noul.toFixed(2)}`)
    else if (a.type === 'score') parts.push(`${id}=${a.score.toFixed(1)}`)
    else parts.push(`${id}=${a.choice}`)
  }
  return parts.join('  ')
}
