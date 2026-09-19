import { chmod, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configure, ConfigureError, type ConfigureIO } from '../src/configure.ts'

describe('configure', () => {
  let dir: string
  let path: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'raincheck-configure-'))
    path = join(dir, 'nested', 'credentials.json') // nested: exercises mkdir -p
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  type Stub = {
    answers?: string[]
    typesafe?: number
    raindrop?: number
    isTTY?: boolean
  }

  const io = (stub: Stub = {}) => {
    const answers = [...(stub.answers ?? ['ts-key', 'rd-token'])]
    const printed: string[] = []
    const calls: Array<{ url: string; auth: string }> = []
    const io: ConfigureIO = {
      isTTY: stub.isTTY ?? true,
      promptSecret: async () => answers.shift() ?? '',
      print: (l) => printed.push(l),
      path,
      fetch: async (url, init) => {
        calls.push({ url, auth: (init.headers as Record<string, string>).Authorization ?? '' })
        if (url.includes('typesafe')) return new Response('[]', { status: stub.typesafe ?? 200 })
        return new Response(JSON.stringify({ result: true, user: { fullName: 'Ryo' } }), {
          status: stub.raindrop ?? 200,
        })
      },
    }
    return { io, printed, calls }
  }

  it('verifies both secrets and writes the file with 0600', async () => {
    const { io: i, printed, calls } = io()
    await configure(i)

    expect(calls).toEqual([
      { url: 'https://api.typesafe.ai/v1/models', auth: 'Bearer ts-key' },
      { url: 'https://api.raindrop.io/rest/v1/user', auth: 'Bearer rd-token' },
    ])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      typesafe_api_key: 'ts-key',
      raindrop_token: 'rd-token',
    })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(printed).toContain('  ok (Ryo)')
  })

  it('tightens permissions on an existing loose file', async () => {
    await configure(io().io)
    await chmod(path, 0o644)
    await configure(io().io)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('keeps the current value when the user enters nothing', async () => {
    await configure(io({ answers: ['old-ts', 'old-rd'] }).io)
    const { io: i, printed } = io({ answers: ['', 'new-rd'] })
    await configure(i)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      typesafe_api_key: 'old-ts',
      raindrop_token: 'new-rd',
    })
    // The hint shows only the tail of the existing secret.
    expect(printed.join('\n')).not.toContain('old-ts')
  })

  it('requires a value when there is nothing to keep', async () => {
    await expect(configure(io({ answers: ['', ''] }).io)).rejects.toThrow('TypeSafe API key is required')
  })

  it('does not write anything when TypeSafe rejects the key', async () => {
    const { io: i, calls } = io({ typesafe: 401 })
    await expect(configure(i)).rejects.toThrow(ConfigureError)
    await expect(configure(i)).rejects.toThrow('TypeSafe rejected the API key (401)')
    expect(calls.every((c) => c.url.includes('typesafe'))).toBe(true)
    await expect(stat(path)).rejects.toThrow()
  })

  it('does not write anything when Raindrop rejects the token', async () => {
    await expect(configure(io({ raindrop: 401 }).io)).rejects.toThrow('Raindrop rejected the token (401)')
    await expect(stat(path)).rejects.toThrow()
  })

  it('refuses without a TTY and explains the manual route', async () => {
    const { io: i, calls } = io({ isTTY: false })
    await expect(configure(i)).rejects.toThrow('stdin is not a terminal')
    await expect(configure(i)).rejects.toThrow('umask 077')
    expect(calls).toEqual([])
  })
})
