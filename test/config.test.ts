import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfigPath, loadConfig, resolveSecret } from '../src/config.ts'

describe('defaultConfigPath', () => {
  it('honours XDG_CONFIG_HOME', () => {
    expect(defaultConfigPath({ XDG_CONFIG_HOME: '/x' })).toBe('/x/raincheck/config.json')
  })

  it('falls back to ~/.config', () => {
    expect(defaultConfigPath({})).toMatch(/\/\.config\/raincheck\/config\.json$/)
  })
})

describe('loadConfig', () => {
  let dir: string
  let path: string
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'raincheck-'))
    path = join(dir, 'config.json')
    warnings.length = 0
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const write = async (body: string, mode = 0o600) => {
    await writeFile(path, body)
    await chmod(path, mode)
  }

  it('returns {} when the file does not exist', async () => {
    expect(await loadConfig({ path, warn })).toEqual({})
    expect(warnings).toEqual([])
  })

  it('reads both keys', async () => {
    await write('{"typesafe_api_key":"k","raindrop_token":"t"}')
    expect(await loadConfig({ path, warn })).toEqual({ typesafeApiKey: 'k', raindropToken: 't' })
    expect(warnings).toEqual([])
  })

  it('leaves absent keys undefined and ignores unknown ones', async () => {
    await write('{"raindrop_token":"t","future":1}')
    expect(await loadConfig({ path, warn })).toEqual({ raindropToken: 't' })
  })

  it('warns when the file is readable by others', async () => {
    await write('{"raindrop_token":"t"}', 0o644)
    await loadConfig({ path, warn })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('chmod 600')
    expect(warnings[0]).toContain(path)
  })

  it('rejects invalid JSON with the path in the message', async () => {
    await write('{oops')
    await expect(loadConfig({ path, warn })).rejects.toThrow(`${path}: not valid JSON`)
  })

  it('rejects non-object documents', async () => {
    await write('["k"]')
    await expect(loadConfig({ path, warn })).rejects.toThrow('expected a JSON object')
  })

  it('rejects empty or non-string values', async () => {
    await write('{"typesafe_api_key":""}')
    await expect(loadConfig({ path, warn })).rejects.toThrow('"typesafe_api_key" must be a non-empty string')
    await write('{"raindrop_token":42}')
    await expect(loadConfig({ path, warn })).rejects.toThrow('"raindrop_token" must be a non-empty string')
  })
})

describe('resolveSecret', () => {
  it('prefers the environment', () => {
    expect(resolveSecret('K', 'file', { K: 'env' })).toBe('env')
  })

  it('falls back to the file when env is unset or empty', () => {
    expect(resolveSecret('K', 'file', {})).toBe('file')
    expect(resolveSecret('K', 'file', { K: '' })).toBe('file')
  })

  it('returns undefined when neither is set', () => {
    expect(resolveSecret('K', undefined, {})).toBeUndefined()
  })
})
