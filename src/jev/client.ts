import type { FetchLike, JevAsker, JevQuestions, JevResponse } from '../types.ts'

export type JevClientOptions = {
  apiKey: string
  model: string
  /** @default globalThis.fetch */
  fetch?: FetchLike
  /** @default "https://api.typesafe.ai" */
  baseUrl?: string
  /** Retries after the first attempt, for 429/529 only. @default 5 */
  maxRetries?: number
  /** Waits before retry `attempt` (0-based). @default exponential with jitter, 0.5–1 s doubling per attempt */
  backoff?: (attempt: number) => Promise<void>
}

/** Non-2xx response from Jev; `status` and the raw `body` are kept for diagnosis. */
export class JevHttpError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`Jev HTTP ${status}: ${body}`)
    this.name = 'JevHttpError'
    this.status = status
    this.body = body
  }
}

const RETRYABLE = new Set([429, 529])

/**
 * JevAsker over `POST /v1/systemone` using `fetch` directly; the API surface
 * is too small to justify the SDK. Retries 429 and 529 with backoff, then
 * throws `JevHttpError`; every other non-2xx throws immediately with the
 * response body, because 422 bodies name the offending field.
 * https://docs.typesafe.ai/api.md
 */
export function createJevClient(opts: JevClientOptions): JevAsker {
  const fetchFn = opts.fetch ?? globalThis.fetch
  const url = `${opts.baseUrl ?? 'https://api.typesafe.ai'}/v1/systemone`
  const maxRetries = opts.maxRetries ?? 5
  const backoff = opts.backoff ?? defaultBackoff

  return {
    async ask(state: unknown, questions: JevQuestions): Promise<JevResponse> {
      const body = JSON.stringify({ model: opts.model, state, questions })
      for (let attempt = 0; ; attempt++) {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            'Content-Type': 'application/json',
          },
          body,
        })
        if (res.ok) return (await res.json()) as JevResponse
        const text = await res.text()
        if (RETRYABLE.has(res.status) && attempt < maxRetries) {
          await backoff(attempt)
          continue
        }
        throw new JevHttpError(res.status, text)
      }
    },
  }
}

function defaultBackoff(attempt: number): Promise<void> {
  const base = 500 * 2 ** attempt
  const jitter = Math.random() * base
  return new Promise((r) => setTimeout(r, base + jitter))
}
