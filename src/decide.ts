import type { Decision, Bookmark, JevAnswers, JevResponse, Thresholds, Verdict } from './types.ts'

/** Pure. `res.answers` is stored on the verdict as-is, not copied. */
export function decide(
  bookmark: Bookmark,
  res: Pick<JevResponse, 'model' | 'answers'>,
  thresholds: Thresholds,
): Verdict {
  return { bookmark, answers: res.answers, model: res.model, decision: decision(res.answers, thresholds) }
}

function decision(answers: JevAnswers, thresholds: Thresholds): Decision {
  const relevant = answers.relevant
  if (!relevant || relevant.type !== 'noul') {
    // Skip rather than throw: the verdict still reaches the sink with its
    // answers attached, which is what makes the bad answer diagnosable.
    return 'skip'
  }
  return relevant.noul >= thresholds.relevant ? 'surface' : 'skip'
}

/** `relevant` descending, ties broken by `actionable` descending. Returns a new array. */
export function rank(verdicts: Verdict[]): Verdict[] {
  return [...verdicts].sort((a, b) => {
    const r = noul(b, 'relevant') - noul(a, 'relevant')
    if (r !== 0) return r
    return noul(b, 'actionable') - noul(a, 'actionable')
  })
}

function noul(v: Verdict, id: string): number {
  const a = v.answers[id]
  return a?.type === 'noul' ? a.noul : 0
}
