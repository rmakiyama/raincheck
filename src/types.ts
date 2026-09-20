export type Bookmark = {
  /** `<source>:<native id>`; unique across sources. */
  id: string
  /** Which BookmarkSource produced it, e.g. `"raindrop"`. */
  source: string
  url: string
  title: string
  /** Site-provided description. Usually the meta description, so often short. */
  summary?: string
  /** Written by the person — strong signal for relevance. */
  note?: string
  /** Passages the person highlighted — strong signal for relevance. */
  highlights?: string[]
  tags?: string[]
  /** ISO 8601. Never handed to Jev: date arithmetic is done in code. */
  savedAt: string
  domain?: string
}

// Jev (TypeSafe System One) request/response shapes. Source of truth:
// https://docs.typesafe.ai/api.md

export type NoulQuestion = {
  type: 'noul'
  instructions: string
  criteria?: { true: string; false: string }
}

export type ChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string | null>
}

export type ScoreQuestion = {
  type: 'score'
  instructions: string
  /** Ordered low → high; the index is the level Jev reports. */
  criteria: string[]
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion
export type JevQuestions = Record<string, JevQuestion>

/** No `confidence` field: the probability itself is the only uncertainty signal. */
export type NoulAnswer = { type: 'noul'; noul: number }

export type ChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Record<string, number>
}

export type ScoreAnswer = {
  type: 'score'
  score: number
  confidence: number
  legend: Record<string, string>
  probabilities: Record<string, number>
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer
export type JevAnswers = Record<string, JevAnswer>

export type JevResponse = {
  model: string
  answers: JevAnswers
  usage: { input_tokens: number; output_tokens: number }
}

// The four boundaries. They exist so tests can replace every external system;
// each has exactly one real implementation today.

/** Where bookmarks come from. */
export interface BookmarkSource {
  readonly name: string
  /**
   * Yields bookmarks in the source's preferred order, stopping after `limit`
   * when given. Bookmarks the source deems unjudgeable (e.g. dead links) are
   * not yielded and do not count toward `limit`. May throw mid-iteration on
   * I/O failure; bookmarks already yielded remain valid.
   */
  fetch(opts: { limit?: number }): AsyncIterable<Bookmark>
}

/** One project's share of `RecentWork`. */
export type RecentProject = {
  name: string
  branches: string[]
  sessions: number
  titles: string[]
  /** Newest first. */
  prompts: string[]
}

/**
 * What Jev sees as `recent_work`. Already redacted: nothing downstream masks
 * it again before it leaves the machine.
 */
export type RecentWork = {
  days: number
  /** Most recent activity first. Questions address projects by index. */
  projects: RecentProject[]
}

/** Produces what Jev sees as `recent_work`. */
export interface InterestSource {
  readonly name: string
  /** Resolves with at least one project. Rejects when there is nothing to describe. */
  load(): Promise<RecentWork>
}

/** One round-trip to Jev. */
export interface JevAsker {
  /** Rejects on any non-2xx response; the caller decides whether to continue. */
  ask(state: unknown, questions: JevQuestions): Promise<JevResponse>
}

/** Where verdicts go once judging is finished. */
export interface Sink {
  /** Called once per run with every verdict, already ranked; may be empty. */
  emit(verdicts: Verdict[]): Promise<void>
}

/**
 * The slice of `fetch` this program uses: a string URL and a mandatory `init`.
 * Narrower than `typeof fetch` so stubs need only implement this shape;
 * `globalThis.fetch` satisfies it.
 */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/**
 * `helps` and `related` are the two sections shown; `skip` is not shown;
 * `consulted`: the person's own prompts already refer to the article, so it
 * was not judged.
 */
export type Decision = 'helps' | 'related' | 'skip' | 'consulted'

export type Verdict = {
  bookmark: Bookmark
  /** Every answer Jev returned, probabilities intact, so a decision can be traced later. Empty when not judged. */
  answers: JevAnswers
  /** The model ID Jev reported, e.g. `jev-1.13.0`; versioned even when an alias was requested. Absent when not judged. */
  model?: string
  /** The level `decide` read from each Score answer it could read, by question id; what `decision` was looked up with. Absent when not judged. */
  levels?: Record<string, number>
  decision: Decision
}
