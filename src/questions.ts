import type { Bookmark, Decision, JevQuestions, RecentWork } from './types.ts'

/**
 * A versioned ID, not `jev-latest`: `DEFAULT_THRESHOLDS` were tuned against
 * this version, and an alias moves without notice. Moving to a newer model
 * means recalibrating the thresholds at the same time.
 */
export const JEV_MODEL = 'jev-1.13.0'

/**
 * Question IDs are for code only — the model never sees them — so each
 * `instructions`/`criteria` must carry the question's full meaning.
 *
 * Written in English on purpose: TypeSafe's model docs state English gives the
 * best accuracy and CJK is "supported but less reliable". The state itself
 * (digest, article) may be in any language.
 */
export const QUESTIONS = {
  depth: {
    type: 'score',
    instructions: 'How much focused effort does `article` demand to get its value?',
    criteria: [
      'The title and summary already deliver the point; nothing is gained by opening it.',
      'A short read; can be finished in a few minutes without taking notes.',
      'A long or technical piece worth a dedicated sitting.',
      'Requires working through it hands-on (following code, running examples, or reproducing steps).',
    ],
  },
  // `distance` and `effect` decide, through `OUTCOME`. Their levels are
  // outcomes, not degrees, so there is no threshold to fit: what moves an
  // article between sections is the wording of a level or a cell of the table.
  distance: {
    type: 'score',
    instructions:
      'How close is the main subject of `article` to what the person is currently working on or thinking through, as shown in `recent_work`?',
    criteria: [
      "No contact: the article's subject has nothing to do with what the person is working on or thinking through; at most they share a word.",
      "Touches it: the article's main subject is something else and only touches on what the person is working on; or it treats the same kind of question with a different object or approach.",
      "The subject itself: the article's main subject is the very thing the person is working on or thinking through, whether that is a technology, a way of working, or a question about a design or a product.",
    ],
  },
  effect: {
    type: 'score',
    instructions:
      'After reading `article`, how would what the person is currently doing, as shown in `recent_work`, change?',
    criteria: [
      'Not at all: it confirms what the person already does; it is general background, opinion, or news; or it is an overview or a list of practices that does not bear on a choice the person is facing.',
      'A choice is informed: it gives options, pitfalls, or a comparison that bear specifically on a choice the person is facing now — what to use, how to build something, how to proceed, what to make.',
      'Applied as is: it gives a concrete method, decision, or procedure the person can apply directly to what they are doing now.',
    ],
  },
} as const satisfies JevQuestions

/** Short names for the levels of `depth`, in `criteria` order, for display. */
export const DEPTH_LABELS = ['the title says it all', 'a short read', 'a sitting', 'hands-on'] as const

/**
 * What to do with an article, by the nearest level of `distance` (rows) and
 * `effect` (columns), both in `criteria` order. An article that changes
 * nothing is not worth reading however close; one that is merely adjacent
 * goes to the second section, where a suggestion may still be a discovery.
 */
export const OUTCOME = [
  // effect:  nothing  informs    applies
  ['skip', 'skip', 'skip'], // distance: no contact
  ['skip', 'related', 'related'], // touches it
  ['skip', 'helps', 'helps'], // the subject itself
] as const satisfies readonly (readonly Decision[])[]

/**
 * The state for one article. Kept minimal because unrelated fields lower
 * accuracy: `savedAt` is out (Jev cannot do date math) and `url` is out
 * (`domain` carries the same signal in fewer tokens).
 */
export function buildState(recentWork: RecentWork, bookmark: Bookmark) {
  const article: Record<string, unknown> = { title: bookmark.title }
  if (bookmark.summary) article.summary = bookmark.summary
  if (bookmark.note) article.note = bookmark.note
  if (bookmark.highlights?.length) article.highlights = bookmark.highlights
  if (bookmark.tags?.length) article.tags = bookmark.tags
  if (bookmark.domain) article.domain = bookmark.domain
  return { recent_work: recentWork, article }
}
