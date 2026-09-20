import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** `$XDG_CONFIG_HOME/raincheck`, falling back to `~/.config/raincheck`. */
export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'raincheck')
}

/** The secrets file. Kept apart from config.json so only it needs mode 0600. */
export function defaultCredentialsPath(env?: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'credentials.json')
}

/** The option defaults file. */
export function defaultConfigPath(env?: NodeJS.ProcessEnv): string {
  return join(configDir(env), 'config.json')
}

type Rule = {
  accepts(n: number): boolean
  /** Completes "must be …" in error messages. */
  expected: string
}

const integer = (min: number): Rule => ({
  accepts: (n) => Number.isInteger(n) && n >= min,
  expected: min > -Infinity ? `an integer >= ${min}` : 'an integer',
})

/**
 * The options a person may tune, each with the one rule that both its flag
 * and its config.json key are checked against, so the two cannot disagree.
 */
export const OPTIONS = {
  days: integer(1),
  limit: integer(0),
  top: integer(0),
  collection: integer(-Infinity),
  concurrency: integer(1),
} satisfies Record<string, Rule>

export type OptionName = keyof typeof OPTIONS

/** Option defaults read from config.json. Absent means "not in the file". */
export type Config = Partial<Record<OptionName, number>>

/** Built-in defaults. `limit` and `top` have none: unset means no cap. */
export const DEFAULTS = {
  days: 7,
  collection: 0,
  concurrency: 10,
}

/** What a run uses once flags, config.json, and `DEFAULTS` are merged. */
export type Options = {
  days: number
  limit?: number
  top?: number
  collection: number
  concurrency: number
}

/** A flag value that breaks its rule, distinguishable from any other failure. */
export class OptionError extends Error {}

/**
 * A flag wins over config.json, which wins over `DEFAULTS`. `flags` are the
 * raw command-line strings; one that breaks its rule throws `OptionError`.
 */
export function resolveOptions(flags: Partial<Record<OptionName, string>>, config: Config): Options {
  const flag = (name: OptionName): number | undefined => {
    const raw = flags[name]
    if (raw === undefined) return undefined
    // Number('') is 0, which would let a bare `--top=` pass as a real value.
    const n = raw.trim() === '' ? NaN : Number(raw)
    if (!OPTIONS[name].accepts(n)) throw new OptionError(`--${name} must be ${OPTIONS[name].expected}`)
    return n
  }
  return {
    days: flag('days') ?? config.days ?? DEFAULTS.days,
    limit: flag('limit') ?? config.limit,
    top: flag('top') ?? config.top,
    collection: flag('collection') ?? config.collection ?? DEFAULTS.collection,
    concurrency: flag('concurrency') ?? config.concurrency ?? DEFAULTS.concurrency,
  }
}

/** Credentials read from credentials.json. Absent means "not in the file". */
export type Credentials = {
  typesafeApiKey?: string
  raindropToken?: string
}

// File keys are snake_case to mirror the env var names they stand in for.
const CREDENTIAL_KEYS = {
  typesafe_api_key: 'typesafeApiKey',
  raindrop_token: 'raindropToken',
} as const satisfies Record<string, keyof Credentials>

export type LoadConfigOptions = {
  /** @default defaultConfigPath() */
  path?: string
}

/**
 * Reads the option defaults. A missing file resolves to `{}`; a present but
 * malformed file rejects, so a typo cannot masquerade as "not configured".
 * Each value is held to the same rule as its flag. A credential in this file
 * rejects too: only credentials.json is kept at mode 0600.
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<Config> {
  const path = opts.path ?? defaultConfigPath()
  const parsed = await readObject(path)
  if (parsed === undefined) return {}

  for (const key of Object.keys(CREDENTIAL_KEYS)) {
    if (parsed[key] !== undefined) {
      throw new Error(`${path}: "${key}" is a secret; move it to ${join(dirname(path), 'credentials.json')}`)
    }
  }

  const config: Config = {}
  for (const name of Object.keys(OPTIONS) as OptionName[]) {
    const value = parsed[name]
    if (value === undefined) continue
    if (typeof value !== 'number' || !OPTIONS[name].accepts(value)) {
      throw new Error(`${path}: "${name}" must be ${OPTIONS[name].expected}`)
    }
    config[name] = value
  }
  return config
}

export type LoadCredentialsOptions = {
  /** @default defaultCredentialsPath() */
  path?: string
  /** Receives non-fatal problems such as loose file permissions. */
  warn?: (msg: string) => void
}

/**
 * Reads the credentials file. A missing file resolves to `{}`; a present but
 * malformed file rejects, so a typo cannot masquerade as "not configured".
 * The file is plaintext; on POSIX, a mode readable by group/other triggers
 * `warn` but does not reject.
 */
export async function loadCredentials(opts: LoadCredentialsOptions = {}): Promise<Credentials> {
  const path = opts.path ?? defaultCredentialsPath()
  const parsed = await readObject(path)
  if (parsed === undefined) return {}

  if (process.platform !== 'win32') {
    const mode = (await stat(path)).mode & 0o777
    if (mode & 0o077) {
      opts.warn?.(`${path} is readable by others (mode ${mode.toString(8)}); run: chmod 600 ${path}`)
    }
  }

  const credentials: Credentials = {}
  for (const [fileKey, key] of Object.entries(CREDENTIAL_KEYS)) {
    const value = parsed[fileKey]
    if (value === undefined) continue
    if (typeof value !== 'string' || value === '') {
      throw new Error(`${path}: "${fileKey}" must be a non-empty string`)
    }
    credentials[key] = value
  }
  return credentials
}

async function readObject(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw err
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(`${path}: not valid JSON (${(err as Error).message})`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: expected a JSON object`)
  }
  return parsed as Record<string, unknown>
}

/** The env var if set and non-empty, else the file value, else `undefined`. */
export function resolveSecret(
  envName: string,
  fileValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[envName] || fileValue
}
