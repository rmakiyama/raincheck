#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { parseArgs } from 'node:util'
import { configure, ConfigureError, promptSecretTTY } from './configure.ts'
import {
  defaultCredentialsPath,
  loadConfig,
  loadCredentials,
  OPTIONS,
  resolveSecret,
  type OptionName,
} from './config.ts'
import { createClaudeSessionsInterestSource } from './interests/claude-sessions.ts'
import { createJevClient } from './jev/client.ts'
import { DEFAULT_THRESHOLDS, JEV_MODEL } from './questions.ts'
import { createRaindropSource } from './raindrop/source.ts'
import { run } from './run.ts'
import { createJsonlSink } from './sinks/jsonl.ts'
import { createStdoutSink } from './sinks/stdout.ts'

/** Built-in defaults. config.json overrides these; a flag overrides both. */
const DEFAULTS = {
  days: 7,
  threshold: DEFAULT_THRESHOLDS.relevant,
  collection: 0,
  concurrency: 10,
}

const USAGE = `raincheck — the reading you put off. which ones are worth cashing in today.

usage: raincheck [options]        judge bookmarks against recent Claude Code sessions
       raincheck context          print the session digest that would be sent to Jev
       raincheck configure        store API credentials (prompts, no echo)

  --days N          look back N days of Claude Code sessions (default: ${DEFAULTS.days})
  --limit N         fetch and judge at most N bookmarks (default: all)
  --top N           print at most N surfaced bookmarks (default: all surfaced)
  --threshold X     surface when relevant >= X (default: ${DEFAULTS.threshold})
  --jsonl           write every verdict (surfaced or not) as JSONL to stdout
  --collection=ID   Raindrop collection: 0 = all, -1 = Unsorted (default: ${DEFAULTS.collection}).
                    Negative ids need the = form: --collection=-1
  --concurrency N   parallel Jev calls (default: ${DEFAULTS.concurrency})
  -h, --help

defaults:    ~/.config/raincheck/config.json may set any option above except
             --jsonl, by name: { "days": 14, "top": 5 }. A flag wins.
credentials: env TYPESAFE_API_KEY / RAINDROP_TOKEN win; otherwise
             ~/.config/raincheck/credentials.json, written by \`raincheck configure\`
`

class UsageError extends Error {}

/** Resolves to the exit code: 0 ok, 1 nothing judged or source failed, 2 bad usage. */
async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      days: { type: 'string' },
      limit: { type: 'string' },
      top: { type: 'string' },
      threshold: { type: 'string' },
      jsonl: { type: 'boolean', default: false },
      collection: { type: 'string' },
      concurrency: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }

  const [command, ...rest] = positionals
  if (rest.length > 0 || (command !== undefined && !['configure', 'context'].includes(command))) {
    throw new UsageError(`unknown command "${positionals.join(' ')}"\n\n${USAGE}`)
  }

  if (command === 'configure') {
    await configure({
      isTTY: Boolean(process.stdin.isTTY),
      promptSecret: promptSecretTTY,
      print: (line) => process.stderr.write(line + '\n'),
      fetch: globalThis.fetch,
      path: defaultCredentialsPath(),
    })
    return 0
  }

  const config = await loadConfig()
  const days = flag('days', values.days) ?? config.days ?? DEFAULTS.days
  const interests = createClaudeSessionsInterestSource({ days })

  if (command === 'context') {
    process.stdout.write(await interests.load())
    return 0
  }

  const limit = flag('limit', values.limit) ?? config.limit
  const top = flag('top', values.top) ?? config.top
  const threshold = flag('threshold', values.threshold) ?? config.threshold ?? DEFAULTS.threshold
  const collectionId = flag('collection', values.collection) ?? config.collection ?? DEFAULTS.collection
  const concurrency = flag('concurrency', values.concurrency) ?? config.concurrency ?? DEFAULTS.concurrency

  const credentials = await loadCredentials({
    warn: (msg) => process.stderr.write(`raincheck: warning: ${msg}\n`),
  })
  const apiKey = requireSecret('TYPESAFE_API_KEY', 'typesafe_api_key', credentials.typesafeApiKey)
  const token = requireSecret('RAINDROP_TOKEN', 'raindrop_token', credentials.raindropToken)

  const sink = values.jsonl ? createJsonlSink(process.stdout) : createStdoutSink(process.stdout, { top })

  const result = await run({
    bookmarks: createRaindropSource({ token, collectionId }),
    interests,
    jev: createJevClient({ apiKey, model: JEV_MODEL }),
    sink,
    thresholds: { relevant: threshold },
    limit,
    concurrency,
    onError: (bookmark, err) => {
      process.stderr.write(`! ${bookmark.id} ${bookmark.url}\n  ${describe(err)}\n`)
    },
  })

  const surfaced = result.verdicts.filter((v) => v.decision === 'surface').length
  process.stderr.write(
    `judged ${result.verdicts.length}, surfaced ${surfaced}, failed ${result.failed}, ` +
      `tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens}\n`,
  )
  if (result.sourceError !== undefined) {
    process.stderr.write(`raincheck: source stopped early: ${describe(result.sourceError)}\n`)
    return 1
  }
  return result.failed > 0 && result.verdicts.length === 0 ? 1 : 0
}

function requireSecret(envName: string, fileKey: string, fileValue: string | undefined): string {
  const v = resolveSecret(envName, fileValue)
  if (!v) throw new UsageError(`${envName} is not set (env var, or "${fileKey}" in ${defaultCredentialsPath()})`)
  return v
}

/** A flag's value, held to the same rule as its config.json key. */
function flag(name: OptionName, raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  // Number('') is 0, which would let a bare `--top=` pass as a real value.
  const n = raw.trim() === '' ? NaN : Number(raw)
  if (!OPTIONS[name].accepts(n)) throw new UsageError(`--${name} must be ${OPTIONS[name].expected}`)
  return n
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// No process.exit(): stdout to a pipe is async on macOS and exit() would truncate it.
try {
  process.exitCode = await main()
} catch (err) {
  process.stderr.write(`raincheck: ${describe(err)}\n`)
  const usage =
    err instanceof UsageError ||
    err instanceof ConfigureError ||
    Boolean((err as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS'))
  process.exitCode = usage ? 2 : 1
}
