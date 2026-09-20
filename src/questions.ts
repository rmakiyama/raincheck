import type { Bookmark, JevQuestions, RecentWork, Thresholds } from './types.ts'

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
  // `distance` and `effect` are recorded, not decided on: candidates to
  // replace `relevant` + threshold with two Scores whose levels are the
  // outcomes, combined in code. Kept alongside until labelled data says
  // which decides better.
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

/**
 * `QUESTIONS` plus one `relevant_to::<project name>` Noul per project in
 * `recentWork`: the `relevant` judgment scoped to that project alone.
 * Recorded, not decided on. They exist to measure whether `relevant`, which
 * sees every project at once, is diluted by the ones an article is not about;
 * the project name is in the id so a stored verdict stays readable on its own.
 */
export function buildQuestions(recentWork: RecentWork): JevQuestions {
  const questions: JevQuestions = { ...QUESTIONS }
  recentWork.projects.forEach((project, i) => {
    questions[`relevant_to::${project.name}`] = {
      type: 'noul',
      instructions: `Does \`article\` bear on the project, technologies, or problems described in \`recent_work.projects[${i}]\`?`,
      criteria: QUESTIONS.relevant.criteria,
    }
  })
  return questions
}

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
