import { DEPTH_LABELS } from '../questions.ts'
import type { Sink, Verdict } from '../types.ts'
import type { Writer } from './jsonl.ts'

const SECTIONS = [
  { decision: 'helps', heading: 'Helps with what you are doing now' },
  { decision: 'related', heading: 'Related to what you are doing now' },
] as const

/**
 * Sink that prints `helps` and `related` verdicts under their own headings,
 * in the order received, at most `top` of each. A section with nothing in
 * it is left out; when both are empty it says so.
 */
export function createStdoutSink(out: Writer, opts: { top?: number } = {}): Sink {
  return {
    async emit(verdicts: Verdict[]): Promise<void> {
      let shownAny = false
      for (const { decision, heading } of SECTIONS) {
        const all = verdicts.filter((v) => v.decision === decision)
        const shown = opts.top === undefined ? all : all.slice(0, opts.top)
        if (shown.length === 0) continue
        out.write(`${heading}\n\n`)
        for (const v of shown) {
          out.write(`${v.bookmark.title}\n`)
          out.write(`  ${v.bookmark.url}\n`)
          const depth = v.levels?.depth
          if (depth !== undefined) out.write(`  ${DEPTH_LABELS[depth]}\n`)
          out.write('\n')
        }
        shownAny = true
      }
      if (!shownAny) out.write('nothing worth cashing in today\n')
    },
  }
}
