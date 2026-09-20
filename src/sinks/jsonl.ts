import type { Sink, Verdict } from '../types.ts'

/** Structural subset of a writable stream: anything with a `write(string)`. */
export type Writer = { write(chunk: string): unknown }

/** Sink that writes every verdict, shown or not, as one JSON object per line. */
export function createJsonlSink(out: Writer): Sink {
  return {
    async emit(verdicts: Verdict[]): Promise<void> {
      for (const v of verdicts) out.write(JSON.stringify(v) + '\n')
    },
  }
}
