import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Credentials read from the config file. Absent means "not in the file". */
export type Config = {
  typesafeApiKey?: string
  raindropToken?: string
}

// File keys are snake_case to mirror the env var names they stand in for.
const FILE_KEYS = {
  typesafe_api_key: 'typesafeApiKey',
  raindrop_token: 'raindropToken',
} as const satisfies Record<string, keyof Config>

/** `$XDG_CONFIG_HOME/raincheck/config.json`, falling back to `~/.config`. */
export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(base, 'raincheck', 'config.json')
}

export type LoadConfigOptions = {
  /** @default defaultConfigPath() */
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
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<Config> {
  const path = opts.path ?? defaultConfigPath()

  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }

  if (process.platform !== 'win32') {
    const mode = (await stat(path)).mode & 0o777
    if (mode & 0o077) {
      opts.warn?.(`${path} is readable by others (mode ${mode.toString(8)}); run: chmod 600 ${path}`)
    }
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

  const config: Config = {}
  for (const [fileKey, configKey] of Object.entries(FILE_KEYS)) {
    const value = (parsed as Record<string, unknown>)[fileKey]
    if (value === undefined) continue
    if (typeof value !== 'string' || value === '') {
      throw new Error(`${path}: "${fileKey}" must be a non-empty string`)
    }
    config[configKey] = value
  }
  return config
}

/** The env var if set and non-empty, else the file value, else `undefined`. */
export function resolveSecret(
  envName: string,
  fileValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env[envName] || fileValue
}
