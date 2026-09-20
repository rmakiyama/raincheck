import type { Bookmark, JevQuestions, Thresholds } from './types.ts'

/**
 * A versioned ID, not `jev-latest`: `DEFAULT_THRESHOLDS` were tuned against
 * this version, and an alias moves without notice. Moving to a newer model
 * means recalibrating the thresholds at the same time.
 */
export const JEV_MODEL = 'jev-1.13.0'

export const DEFAULT_THRESHOLDS: Thresholds = {
  // TODO: recalibrate once a week of labelled bookmarks exists; 0.6 rests on 18
  // bookmarks saved on a single day.
  relevant: 0.6,
}

/**
 * Question IDs are for code only — the model never sees them — so each
 * `instructions`/`criteria` must carry the question's full meaning.
 *
 * Written in English on purpose: TypeSafe's model docs state English gives the
 * best accuracy and CJK is "supported but less reliable". The state itself
 * (digest, article) may be in any language.
 */
export const QUESTIONS = {
  relevant: {
    type: 'noul',
    instructions:
      'Does `article` bear on the projects, technologies, or problems described in `recent_work`?',
    criteria: {
      true: 'The article is about a technology, tool, design problem, or domain that appears in the recent work — the person would recognise it as "this is about what I am doing".',
      false:
        'The article is off-topic for everything in the recent work, or only shares a keyword without being about the same thing.',
    },
  },
  actionable: {
    type: 'noul',
    instructions:
      'Does `article` contain something the person could apply right away to a task described in `recent_work`?',
    criteria: {
      true: 'It gives a concrete technique, API, fix, configuration, or decision input that maps directly onto something the person is currently building or debugging.',
      false:
        'It is background, opinion, news, or general education — interesting perhaps, but nothing to apply to the current tasks.',
    },
  },
  already_known: {
    type: 'noul',
    instructions:
      'Does `recent_work` show the person already practising or reasoning through what `article` teaches?',
    criteria: {
      true: "The person's own prompts show them applying, configuring, or weighing exactly the thing the article is about; reading it would confirm what they already do rather than add to it.",
      false:
        "The prompts give no sign the person has engaged with the article's substance, or the article covers a side of it (internals, alternatives, pitfalls, a newer approach) that the prompts do not show them handling.",
    },
  },
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
} as const satisfies JevQuestions

/**
 * The state for one article. Kept minimal because unrelated fields lower
 * accuracy: `savedAt` is out (Jev cannot do date math) and `url` is out
 * (`domain` carries the same signal in fewer tokens).
 */
export function buildState(recentWork: string, bookmark: Bookmark) {
  const article: Record<string, unknown> = { title: bookmark.title }
  if (bookmark.summary) article.summary = bookmark.summary
  if (bookmark.note) article.note = bookmark.note
  if (bookmark.highlights?.length) article.highlights = bookmark.highlights
  if (bookmark.tags?.length) article.tags = bookmark.tags
  if (bookmark.domain) article.domain = bookmark.domain
  return { recent_work: recentWork, article }
}
