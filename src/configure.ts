import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { loadCredentials, type Credentials } from './config.ts'
import type { FetchLike } from './types.ts'

/** The I/O `configure` depends on, injected as one object. */
export type ConfigureIO = {
  isTTY: boolean
  /** Reads one line with echo disabled. Resolves to `''` on a bare Enter. */
  promptSecret(label: string): Promise<string>
  print(line: string): void
  fetch: FetchLike
  /** Credentials file to write. */
  path: string
}

/** A problem the person can fix by re-running. */
export class ConfigureError extends Error {}

/**
 * Interactive credential setup. Prompts for both secrets, verifies each
 * against its API before anything is written, then writes `io.path` with
 * mode 0600. A blank answer keeps the value already in the file. Rejects with
 * `ConfigureError` without a TTY, on a rejected secret, or on a blank answer
 * with nothing to keep. Secrets are never taken as arguments so they cannot
 * land in shell history or `ps`.
 */
export async function configure(io: ConfigureIO): Promise<void> {
  if (!io.isTTY) {
    throw new ConfigureError(
      `stdin is not a terminal. Create ${io.path} by hand:\n` +
        `  mkdir -p ${dirname(io.path)} && (umask 077; cat > ${io.path} <<'EOF'\n` +
        `  { "typesafe_api_key": "...", "raindrop_token": "..." }\n  EOF\n  )`,
    )
  }

  const existing = await loadCredentials({ path: io.path, warn: (m) => io.print(`warning: ${m}`) })
  io.print(`Writing ${io.path}. Leave a field blank to keep its current value.`)

  const typesafeApiKey = await ask(io, 'TypeSafe API key', existing.typesafeApiKey)
  await verifyTypesafe(io, typesafeApiKey)

  const raindropToken = await ask(io, 'Raindrop test token', existing.raindropToken)
  const who = await verifyRaindrop(io, raindropToken)
  io.print(`  ok${who ? ` (${who})` : ''}`)

  await writeCredentials(io.path, { typesafeApiKey, raindropToken })
  io.print(`saved ${io.path} (0600)`)
}

async function ask(io: ConfigureIO, label: string, current: string | undefined): Promise<string> {
  const hint = current ? ` [current: …${current.slice(-4)}]` : ''
  const typed = (await io.promptSecret(`${label}${hint}: `)).trim()
  if (typed) return typed
  if (current) return current
  throw new ConfigureError(`${label} is required`)
}

// /v1/models is the cheapest authenticated TypeSafe call.
async function verifyTypesafe(io: ConfigureIO, key: string): Promise<void> {
  const res = await io.fetch('https://api.typesafe.ai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  if (res.status === 401) throw new ConfigureError('TypeSafe rejected the API key (401)')
  if (!res.ok) throw new ConfigureError(`TypeSafe check failed: HTTP ${res.status} ${await res.text()}`)
  io.print('  ok')
}

// Returns the token owner's name so that a token for the wrong account is
// obvious at the prompt. https://developer.raindrop.io/v1/user
async function verifyRaindrop(io: ConfigureIO, token: string): Promise<string | undefined> {
  const res = await io.fetch('https://api.raindrop.io/rest/v1/user', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new ConfigureError('Raindrop rejected the token (401)')
  if (!res.ok) throw new ConfigureError(`Raindrop check failed: HTTP ${res.status} ${await res.text()}`)
  const body = (await res.json()) as { user?: { fullName?: string; email?: string } }
  return body.user?.fullName || body.user?.email
}

/** Writes the file with mode 0600, creating parent directories with 0700. */
export async function writeCredentials(path: string, credentials: Required<Credentials>): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const body = JSON.stringify(
    { typesafe_api_key: credentials.typesafeApiKey, raindrop_token: credentials.raindropToken },
    null,
    2,
  )
  await writeFile(path, body + '\n', { mode: 0o600 })
  // `mode` only applies on creation; tighten an existing file too.
  await chmod(path, 0o600)
}

/**
 * Reads one line from the terminal without echo. A paste arrives as one chunk
 * and is consumed character by character; backspace edits; Ctrl-C rejects.
 * Requires a TTY on stdin.
 */
export function promptSecretTTY(label: string): Promise<string> {
  const { stdin, stdout } = process
  return new Promise((resolve, reject) => {
    stdout.write(label)
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    let buf = ''
    const done = (fn: () => void) => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\n')
      fn()
    }
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return done(() => resolve(buf))
        if (ch === '') return done(() => reject(new ConfigureError('interrupted')))
        if (ch === '' || ch === '\b') buf = buf.slice(0, -1)
        else buf += ch
      }
    }
    stdin.on('data', onData)
  })
}
