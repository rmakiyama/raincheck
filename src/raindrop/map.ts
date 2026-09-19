import type { Bookmark } from '../types.ts'

/**
 * The documented raindrop fields this adapter reads. Raindrop warns that
 * undocumented fields may be renamed or removed, so nothing else is typed.
 * Every field is optional because the API omits empty ones.
 * https://developer.raindrop.io/v1/raindrops
 */
export type RaindropRecord = {
  _id: number
  link?: string
  title?: string
  excerpt?: string
  note?: string
  tags?: string[]
  domain?: string
  created?: string
  broken?: boolean
  highlights?: Array<{ text?: string }>
}

export const SOURCE_NAME = 'raindrop'

/**
 * Pure. Returns null for records that must not be judged: `broken === true`
 * or no `link`. Blank strings become absent fields, not empty ones, and a
 * blank title falls back to the URL.
 */
export function toBookmark(r: RaindropRecord): Bookmark | null {
  if (r.broken === true) return null
  if (!r.link) return null

  const bookmark: Bookmark = {
    id: `${SOURCE_NAME}:${r._id}`,
    source: SOURCE_NAME,
    url: r.link,
    title: r.title?.trim() || r.link,
    savedAt: r.created ?? '',
  }

  const summary = r.excerpt?.trim()
  if (summary) bookmark.summary = summary

  const note = r.note?.trim()
  if (note) bookmark.note = note

  const highlights = (r.highlights ?? [])
    .map((h) => h.text?.trim())
    .filter((t): t is string => Boolean(t))
  if (highlights.length) bookmark.highlights = highlights

  if (r.tags?.length) bookmark.tags = r.tags

  if (r.domain) bookmark.domain = r.domain

  return bookmark
}
