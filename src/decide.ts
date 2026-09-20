import { OUTCOME, QUESTIONS } from './questions.ts'
import type { Decision, Bookmark, JevAnswers, JevResponse, RecentWork, Verdict } from './types.ts'

/**
 * Pure. True when a prompt in `recentWork` contains the bookmark's URL: the
 * person has already brought the article into their work, so suggesting it
 * again is noise. Scheme, `www.`, a trailing slash, and a fragment are
 * ignored on both sides.
 */
export function consulted(recentWork: RecentWork, bookmark: Bookmark): boolean {
  const url = bareUrl(bookmark.url)
  if (!url) return false
  return recentWork.projects.some((p) => p.prompts.some((text) => bareUrl(text).includes(url)))
}

function bareUrl(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?/g, '')
    .replace(/#[^\s]*/g, '')
    .replace(/\/(?=\s|$)/g, '')
}

/** Pure. `res.answers` is stored on the verdict as-is, not copied. */
export function decide(bookmark: Bookmark, res: Pick<JevResponse, 'model' | 'answers'>): Verdict {
  return { bookmark, answers: res.answers, model: res.model, decision: decision(res.answers) }
}

function decision(answers: JevAnswers): Decision {
  const distance = level(answers, 'distance')
  const effect = level(answers, 'effect')
  // Skip rather than throw: the verdict still reaches the sink with its
  // answers attached, which is what makes the bad answer diagnosable.
  if (distance === undefined || effect === undefined) return 'skip'
  return OUTCOME[distance]![effect]!
}

/**
 * The most likely level; on a tie the lower one, so doubt never promotes an
 * article. Not the rounded `score`: an article the model splits evenly
 * between two levels would cross into the upper one on some runs and not
 * others. `undefined` when the answer is missing, not a Score, or lacks a
 * probability for some level.
 */
export function level(answers: JevAnswers, id: keyof typeof QUESTIONS): number | undefined {
  const a = answers[id]
  if (a?.type !== 'score') return undefined
  let best: number | undefined
  for (let i = 0; i < QUESTIONS[id].criteria.length; i++) {
    const p = a.probabilities[String(i)]
    if (p === undefined) return undefined
    if (best === undefined || p > a.probabilities[String(best)]!) best = i
  }
  return best
}

/** `distance` descending, ties broken by `effect` descending. Returns a new array. */
export function rank(verdicts: Verdict[]): Verdict[] {
  return [...verdicts].sort((a, b) => {
    const d = score(b, 'distance') - score(a, 'distance')
    if (d !== 0) return d
    return score(b, 'effect') - score(a, 'effect')
  })
}

function score(v: Verdict, id: string): number {
  const a = v.answers[id]
  return a?.type === 'score' ? a.score : -1
}
