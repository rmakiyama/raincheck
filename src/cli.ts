#!/usr/bin/env -S node --no-warnings=ExperimentalWarning
import { parseArgs } from 'node:util'
import { configure, ConfigureError, promptSecretTTY } from './configure.ts'
import {
  DEFAULTS,
  defaultCredentialsPath,
  loadConfig,
  loadCredentials,
  OptionError,
  resolveOptions,
  resolveSecret,
} from './config.ts'
import { createClaudeSessionsInterestSource, currentSessionId } from './interests/claude-sessions.ts'
import { createJevClient } from './jev/client.ts'
import { JEV_MODEL } from './questions.ts'
import { createRaindropSource } from './raindrop/source.ts'
import { run } from './run.ts'
import type { InterestSource, Verdict } from './types.ts'
import { createJsonlSink } from './sinks/jsonl.ts'
import { createStdoutSink } from './sinks/stdout.ts'

const USAGE = `raincheck — the reading you put off. which ones are worth cashing in today.

usage: raincheck [options]        judge bookmarks against recent Claude Code sessions
       raincheck context          print the session digest that would be sent to Jev
       raincheck configure        store API credentials (prompts, no echo)

  --days N          look back N days of Claude Code sessions (default: ${DEFAULTS.days})
  --current         use only the Claude Code session this command is run from,
                    whole, instead of the last N days (CLAUDE_CODE_SESSION_ID)
  --limit N         fetch and judge at most N bookmarks (default: all)
  --top N           print at most N bookmarks per section (default: all)
  --jsonl           write every verdict (shown or not) as JSONL to stdout
  --collection=ID   Raindrop collection: 0 = all, -1 = Unsorted (default: ${DEFAULTS.collection}).
                    Negative ids need the = form: --collection=-1
  --concurrency N   parallel Jev calls (default: ${DEFAULTS.concurrency})
  -h, --help

defaults:    ~/.config/raincheck/config.json may set any option above except
             --current and --jsonl, by name: { "days": 14, "top": 5 }. A flag wins.
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
      current: { type: 'boolean', default: false },
      limit: { type: 'string' },
      top: { type: 'string' },
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

  if (values.current && values.days !== undefined) {
    throw new UsageError('--current reads one whole session; --days does not apply')
  }
  const options = resolveOptions(values, await loadConfig())
  const interests = values.current
    ? currentSessionSource()
    : createClaudeSessionsInterestSource({ days: options.days })

  if (command === 'context') {
    process.stdout.write(JSON.stringify(await interests.load(), null, 2) + '\n')
    return 0
  }

  const credentials = await loadCredentials({
    warn: (msg) => process.stderr.write(`raincheck: warning: ${msg}\n`),
  })
  const apiKey = requireSecret('TYPESAFE_API_KEY', 'typesafe_api_key', credentials.typesafeApiKey)
  const token = requireSecret('RAINDROP_TOKEN', 'raindrop_token', credentials.raindropToken)

  const sink = values.jsonl
    ? createJsonlSink(process.stdout)
    : createStdoutSink(process.stdout, { top: options.top })

  const result = await run({
    bookmarks: createRaindropSource({ token, collectionId: options.collection }),
    interests,
    jev: createJevClient({ apiKey, model: JEV_MODEL }),
    sink,
    limit: options.limit,
    concurrency: options.concurrency,
    onError: (bookmark, err) => {
      process.stderr.write(`! ${bookmark.id} ${bookmark.url}\n  ${describe(err)}\n`)
    },
  })

  const count = (d: Verdict['decision']) => result.verdicts.filter((v) => v.decision === d).length
  const consulted = count('consulted')
  const models = [...new Set(result.verdicts.map((v) => v.model).filter(Boolean))].join(',') || '-'
  process.stderr.write(
    `judged ${result.verdicts.length - consulted}, helps ${count('helps')}, related ${count('related')}, consulted ${consulted}, ` +
      `failed ${result.failed}, model=${models}, tokens in=${result.usage.input_tokens} out=${result.usage.output_tokens}\n`,
  )
  if (result.sourceError !== undefined) {
    process.stderr.write(`raincheck: source stopped early: ${describe(result.sourceError)}\n`)
    return 1
  }
  return result.failed > 0 && result.verdicts.length - consulted === 0 ? 1 : 0
}

/**
 * An InterestSource for the session this command runs inside. Names it on
 * stderr once read, so a run can be checked against the work it was judged from.
 */
function currentSessionSource(): InterestSource {
  const id = currentSessionId()
  if (!id) throw new UsageError('--current only works inside a Claude Code session (CLAUDE_CODE_SESSION_ID is not set)')
  const source = createClaudeSessionsInterestSource({ session: id })
  return {
    name: source.name,
    async load() {
      const work = await source.load()
      const title = work.projects[0]?.titles[0]
      process.stderr.write(`session ${id}${title ? `: ${title}` : ''}\n`)
      return work
    },
  }
}

function requireSecret(envName: string, fileKey: string, fileValue: string | undefined): string {
  const v = resolveSecret(envName, fileValue)
  if (!v) throw new UsageError(`${envName} is not set (env var, or "${fileKey}" in ${defaultCredentialsPath()})`)
  return v
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
    err instanceof OptionError ||
    err instanceof ConfigureError ||
    Boolean((err as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS'))
  process.exitCode = usage ? 2 : 1
}
