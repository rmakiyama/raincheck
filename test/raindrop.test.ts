import { describe, expect, it } from 'vitest'
import { toBookmark, type RaindropRecord } from '../src/raindrop/map.ts'
import { createRaindropSource, RaindropHttpError } from '../src/raindrop/source.ts'
import page from './fixtures/raindrop-page.json' with { type: 'json' }

const records = page.items as RaindropRecord[]

describe('toBookmark', () => {
  it('maps every documented field', () => {
    expect(toBookmark(records[0]!)).toEqual({
      id: 'raindrop:1001',
      source: 'raindrop',
      url: 'https://example.com/compose-perf',
      title: 'Stability in Jetpack Compose: what recomposes and why',
      summary: 'A deep dive into stable/unstable types and how the compiler reasons about them.',
      note: 'read before touching the list screen',
      highlights: ['Strong skipping mode changes the default'],
      tags: ['compose', 'android'],
      savedAt: '2026-09-10T08:00:00.000Z',
      domain: 'example.com',
    })
  })

  it('drops broken links', () => {
    expect(toBookmark(records[1]!)).toBeNull()
  })

  it('drops records without a link', () => {
    expect(toBookmark({ _id: 1, title: 'x' })).toBeNull()
  })

  it('leaves optional fields absent rather than empty', () => {
    const bookmark = toBookmark(records[2]!)!
    expect(bookmark.title).toBe('https://example.com/bare') // blank title falls back to URL
    expect(bookmark).not.toHaveProperty('summary')
    expect(bookmark).not.toHaveProperty('note')
    expect(bookmark).not.toHaveProperty('highlights')
    expect(bookmark).not.toHaveProperty('tags')
    expect(bookmark).not.toHaveProperty('domain')
  })

  it('ignores blank highlights and empty tag arrays', () => {
    const bookmark = toBookmark({
      _id: 2,
      link: 'https://x',
      highlights: [{ text: '' }, {}],
      tags: [],
    })!
    expect(bookmark).not.toHaveProperty('highlights')
    expect(bookmark).not.toHaveProperty('tags')
  })
})

describe('createRaindropSource', () => {
  const stubFetch = (pages: unknown[]) => {
    const calls: string[] = []
    const fetch = async (url: string, init: RequestInit) => {
      calls.push(url)
      expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
      const page = Number(new URL(url).searchParams.get('page'))
      const body = pages[page] ?? { result: true, items: [] }
      return new Response(JSON.stringify(body), { status: 200 })
    }
    return { fetch, calls }
  }

  const collect = async (src: ReturnType<typeof createRaindropSource>, limit?: number) => {
    const out = []
    for await (const bookmark of src.fetch(limit === undefined ? {} : { limit })) out.push(bookmark.id)
    return out
  }

  it('paginates until a short page and filters broken records', async () => {
    const { fetch, calls } = stubFetch([
      { result: true, items: [records[0], records[1]] },
      { result: true, items: [records[2]] },
    ])
    const src = createRaindropSource({ token: 'tok', fetch, perPage: 2 })
    expect(await collect(src)).toEqual(['raindrop:1001', 'raindrop:1003'])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('/rest/v1/raindrops/0?')
    expect(calls[0]).toContain('perpage=2')
    expect(calls[0]).toContain('sort=-created')
  })

  it('stops fetching once limit is reached', async () => {
    const { fetch, calls } = stubFetch([
      { result: true, items: [records[0]] },
      { result: true, items: [records[2]] },
      { result: true, items: [records[2]] },
    ])
    const src = createRaindropSource({ token: 'tok', fetch, perPage: 1 })
    expect(await collect(src, 2)).toEqual(['raindrop:1001', 'raindrop:1003'])
    expect(calls).toHaveLength(2)
  })

  it('does not count filtered records toward the limit', async () => {
    const { fetch } = stubFetch([{ result: true, items: [records[1], records[0], records[2]] }])
    const src = createRaindropSource({ token: 'tok', fetch })
    expect(await collect(src, 2)).toEqual(['raindrop:1001', 'raindrop:1003'])
  })

  it('caps perPage at 50', async () => {
    const { fetch, calls } = stubFetch([])
    await collect(createRaindropSource({ token: 'tok', fetch, perPage: 500 }))
    expect(calls[0]).toContain('perpage=50')
  })

  it('uses the given collection id', async () => {
    const { fetch, calls } = stubFetch([])
    await collect(createRaindropSource({ token: 'tok', fetch, collectionId: -1 }))
    expect(calls[0]).toContain('/rest/v1/raindrops/-1?')
  })

  it('throws with status and body on HTTP errors', async () => {
    const fetch = async () => new Response('nope', { status: 401 })
    const src = createRaindropSource({ token: 'tok', fetch })
    await expect(collect(src)).rejects.toThrow(RaindropHttpError)
    await expect(collect(src)).rejects.toThrow('401: nope')
  })
})
