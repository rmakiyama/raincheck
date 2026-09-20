import { OUTCOME, QUESTIONS } from './questions.ts'
import type { Decision, Bookmark, JevAnswers, JevResponse, RecentWork, Verdict } from './types.ts'

/**
 * Pure. True when a prompt in `recentWork` contains the bookmark's URL: the
 * person has already brought the article into their work, so suggesting it
 * again is noise. Whole URLs are compared, ignoring scheme, `www.`, a
 * trailing slash, a fragment, and case; a page under the bookmarked URL is
 * not a match.
 */
export function consulted(recentWork: RecentWork, bookmark: Bookmark): boolean {
  const target = bareUrl(bookmark.url)
  return recentWork.projects.some((p) => p.prompts.some((text) => urlsIn(text).some((u) => bareUrl(u) === target)))
}

// Stops at whitespace, brackets, quotes, and Japanese punctuation, then drops
// the sentence punctuation a URL is often pasted right in front of.
const URL_TOKEN = /https?:\/\/[^\s<>"'()\[\]{}。、（）「」]+/g

function urlsIn(text: string): string[] {
  return (text.match(URL_TOKEN) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ''))
}

function bareUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/#.*$/, '')
    .replace(/\/$/, '')
}

/** Pure. `res.answers` is stored on the verdict as-is, not copied. */
export function decide(bookmark: Bookmark, res: Pick<JevResponse, 'model' | 'answers'>): Verdict {
  const levels: Record<string, number> = {}
  for (const id of Object.keys(QUESTIONS) as (keyof typeof QUESTIONS)[]) {
    const l = level(res.answers, id)
    if (l !== undefined) levels[id] = l
  }
  return { bookmark, answers: res.answers, model: res.model, levels, decision: decision(levels) }
}

function decision(levels: Record<string, number>): Decision {
  const distance = levels.distance
  const effect = levels.effect
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
function level(answers: JevAnswers, id: keyof typeof QUESTIONS): number | undefined {
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

/**
 * `distance` level descending, then `effect` level descending, then the
 * two mean scores the same way. Verdicts without levels go last. Returns a
 * new array.
 */
export function rank(verdicts: Verdict[]): Verdict[] {
  const keys = (v: Verdict) => [
    v.levels?.distance ?? -1,
    v.levels?.effect ?? -1,
    mean(v, 'distance'),
    mean(v, 'effect'),
  ]
  return [...verdicts].sort((a, b) => {
    const ka = keys(a)
    const kb = keys(b)
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i]! - ka[i]!
    return 0
  })
}

function mean(v: Verdict, id: string): number {
  const a = v.answers[id]
  return a?.type === 'score' ? a.score : -1
}
