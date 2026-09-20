import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClaudeSessionsInterestSource,
  isPlumbing,
  projectName,
  redact,
  select,
  type Session,
} from '../src/interests/claude-sessions.ts'

const NOW = Date.parse('2026-09-19T12:00:00Z')
const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()

type Line = Record<string, unknown>

const user = (text: string, daysAgo: number, extra: Line = {}): Line => ({
  type: 'user',
  timestamp: iso(daysAgo),
  cwd: '/Users/me/dev/org/repo',
  gitBranch: 'main',
  sessionId: 's',
  message: { content: text },
  ...extra,
})

const toolResult = (daysAgo: number): Line => ({
  type: 'user',
  timestamp: iso(daysAgo),
  cwd: '/Users/me/dev/org/repo',
  message: { content: [{ type: 'tool_result', content: 'SECRET OUTPUT' }] },
})

const assistant = (text: string, daysAgo: number): Line => ({
  type: 'assistant',
  timestamp: iso(daysAgo),
  cwd: '/Users/me/dev/org/repo',
  message: { content: [{ type: 'text', text }] },
})

const title = (t: string): Line => ({ type: 'ai-title', aiTitle: t, sessionId: 's' })

describe('createClaudeSessionsInterestSource', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'raincheck-sessions-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const session = async (project: string, name: string, lines: Line[]) => {
    await mkdir(join(dir, project), { recursive: true })
    await writeFile(join(dir, project, `${name}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  }

  const load = (opts: Parameters<typeof createClaudeSessionsInterestSource>[0] = {}) =>
    createClaudeSessionsInterestSource({ dir, now: () => NOW, days: 7, home: '/Users/me', ...opts }).load()

  const LONG = 'Migrate the list screen to LazyColumn and fix recomposition of the row bookmarks'

  it('renders project, branch, title, and long prompts; skips assistant text and tool results', async () => {
    await session('p', 'a', [
      title('Compose list performance'),
      user(LONG, 1),
      toolResult(1),
      assistant('I changed the stability annotations in a way you should not see here', 1),
    ])
    const out = await load()
    expect(out).toContain('## org/repo (branches: main) — 1 session')
    expect(out).toContain('- Compose list performance')
    expect(out).toContain(`- "${LONG}"`)
    expect(out).not.toContain('SECRET OUTPUT')
    expect(out).not.toContain('stability annotations')
  })

  it('ignores records outside the window even in recently modified files', async () => {
    await session('p', 'a', [title('old'), user(LONG + ' (old)', 10), user(LONG + ' (new)', 2)])
    const out = await load()
    expect(out).toContain('(new)')
    expect(out).not.toContain('(old)')
  })

  it('drops sessions with nothing inside the window and fails when none remain', async () => {
    await session('p', 'a', [title('old'), user(LONG, 30)])
    await expect(load()).rejects.toThrow('no Claude Code sessions in the last 7 days')
  })

  it('skips subagent transcripts nested under a session', async () => {
    await session('p', 'a', [user(LONG, 1)])
    await session('p/a/subagents', 'agent-1', [user('AGENT PROMPT: ' + LONG, 1)])
    const out = await load()
    expect(out).not.toContain('AGENT PROMPT')
  })

  it('drops short prompts, slash commands, meta and sidechain entries', async () => {
    await session('p', 'a', [
      user(LONG, 1),
      user('OK', 1),
      user('ありがと', 1),
      user('/commit ' + LONG, 1),
      user('META ' + LONG, 1, { isMeta: true }),
      user('SIDE ' + LONG, 1, { isSidechain: true }),
    ])
    const out = await load()
    expect(out.match(/^- "/gm)).toHaveLength(1)
    expect(out).not.toContain('/commit')
    expect(out).not.toContain('META')
    expect(out).not.toContain('SIDE')
  })

  it('deduplicates repeated prompts and orders newest first', async () => {
    await session('p', 'a', [user('FIRST ' + LONG, 3), user('SECOND ' + LONG, 1), user('FIRST ' + LONG, 2)])
    const out = await load()
    expect(out.match(/FIRST/g)).toHaveLength(1)
    expect(out.indexOf('SECOND')).toBeLessThan(out.indexOf('FIRST'))
  })

  it('truncates long prompts and respects the character budget, newest first', async () => {
    const big = (tag: string) => `${tag} ${'lorem ipsum '.repeat(50)}`
    await session('p', 'a', [user(big('OLDEST'), 3), user(big('MIDDLE'), 2), user(big('NEWEST'), 1)])
    const out = await load({ maxPromptChars: 100, budgetChars: 220 })
    expect(out).toContain('NEWEST')
    expect(out).toContain('MIDDLE')
    expect(out).not.toContain('OLDEST')
    expect(out).toContain('…')
    expect(out).not.toContain('lorem ipsum '.repeat(20))
  })

  it('keeps the newest prompts of every project even when one busy project would fill the budget', async () => {
    const busy = Array.from({ length: 20 }, (_, i) => user(`BUSY ${i} ${LONG}`, 1, { cwd: '/Users/me/dev/org/busy' }))
    await session('p1', 'a', busy)
    await session('p2', 'b', [
      user(`QUIET 0 ${LONG}`, 4, { cwd: '/Users/me/dev/org/quiet' }),
      user(`QUIET 1 ${LONG}`, 5, { cwd: '/Users/me/dev/org/quiet' }),
    ])
    const out = await load({ budgetChars: 600, maxPromptChars: 100, guaranteedPrompts: 2 })
    expect(out).toContain('QUIET 0')
    expect(out).toContain('QUIET 1')
    expect(out.match(/BUSY/g)?.length).toBeGreaterThan(2)
  })

  it('groups sessions by project with worktrees folded into their repo', async () => {
    await session('p1', 'a', [
      user(LONG + ' one', 1, { cwd: '/Users/me/dev/org/repo/.claude/worktrees/feat-x', gitBranch: 'feat-x' }),
    ])
    await session('p2', 'b', [user(LONG + ' two', 2, { cwd: '/Users/me/dev/org/repo', gitBranch: 'main' })])
    await session('p3', 'c', [user(LONG + ' three', 3, { cwd: '/Users/me/dev/other', gitBranch: 'main' })])
    const out = await load()
    expect(out).toContain('## org/repo (branches: feat-x, main) — 2 sessions')
    expect(out).toContain('## dev/other (branches: main) — 1 session')
    expect(out.indexOf('org/repo')).toBeLessThan(out.indexOf('## dev/other'))
  })

  it('redacts obvious secrets in prompts and titles', async () => {
    await session('p', 'a', [
      title('Rotate token ghp_abcdefghijklmnopqrstuvwxyz0123'),
      user(`Use Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig and mail me@example.com ${LONG}`, 1),
    ])
    const out = await load()
    expect(out).not.toContain('ghp_')
    expect(out).not.toContain('eyJhbGci')
    expect(out).not.toContain('me@example.com')
    expect(out).toContain('[redacted]')
  })

  it('returns [] cleanly when the projects dir does not exist', async () => {
    await expect(load({ dir: join(dir, 'nope') })).rejects.toThrow('no Claude Code sessions')
  })
})

describe('select', () => {
  const prompt = (text: string, daysAgo: number) => ({ at: NOW - daysAgo * DAY, text })
  const session = (project: string, lastActivityDaysAgo: number, prompts: Session['prompts']): Session => ({
    sessionId: project,
    project,
    lastActivity: NOW - lastActivityDaysAgo * DAY,
    prompts,
  })
  // 50 chars each so budgets below count in whole prompts; words, not a run of
  // one letter, or `redact` would treat the padding as a token.
  const P = (tag: string) => `${tag} lorem ipsum dolor sit amet consectetur adipiscing elit`.slice(0, 50)
  const opts = { days: 7, budgetChars: 500, guaranteedPrompts: 3, maxPromptChars: 300, minPromptChars: 40 }

  it('gives every project its newest prompts first, then spends the rest newest-first', () => {
    const busy = session('busy', 1, Array.from({ length: 20 }, (_, i) => prompt(P(`busy${i}`), 1 + i / 100)))
    const quiet = session('quiet', 3, [prompt(P('quiet0'), 3), prompt(P('quiet1'), 4), prompt(P('quiet2'), 5), prompt(P('quiet3'), 6)])
    const older = session('older', 6, [prompt(P('older0'), 6)])
    const d = select([older, quiet, busy], opts)

    expect(d.projects.map((p) => p.name)).toEqual(['busy', 'quiet', 'older'])
    // 500 chars = 10 prompts: 3 guaranteed to busy, 3 to quiet, 1 to older, 3 more to busy by recency.
    expect(d.projects[0]!.prompts).toHaveLength(6)
    expect(d.projects[0]!.prompts[0]).toContain('busy0')
    expect(d.projects[1]!.prompts.map((t) => t.slice(0, 6))).toEqual(['quiet0', 'quiet1', 'quiet2'])
    expect(d.projects[2]!.prompts).toHaveLength(1)
  })

  it('falls back to pure recency when the guarantee is zero', () => {
    const busy = session('busy', 1, Array.from({ length: 20 }, (_, i) => prompt(P(`busy${i}`), 1 + i / 100)))
    const quiet = session('quiet', 3, [prompt(P('quiet0'), 3)])
    const d = select([quiet, busy], { ...opts, guaranteedPrompts: 0 })
    expect(d.projects[0]!.prompts).toHaveLength(10)
    expect(d.projects[1]!.prompts).toHaveLength(0)
  })

  it('carries branches, session counts and redacted titles', () => {
    const a = { ...session('repo', 1, [prompt(P('a'), 1)]), branch: 'main', title: 'Rotate ghp_abcdefghijklmnopqrstuvwxyz0123' }
    const b = { ...session('repo', 2, []), branch: 'feat', title: 'Other' }
    const [p] = select([a, b], opts).projects
    expect(p).toMatchObject({ name: 'repo', branches: ['main', 'feat'], sessions: 2 })
    expect(p!.titles).toEqual(['Rotate [redacted]', 'Other'])
  })
})

describe('projectName', () => {
  const home = homedir()
  it('keeps the last two segments and folds worktrees into their repo', () => {
    expect(projectName(`${home}/dev/org/repo`)).toBe('org/repo')
    expect(projectName(`${home}/dev/org/repo/.claude/worktrees/feat-1234`)).toBe('org/repo')
    expect(projectName(`${home}/src/deep/org/repo`)).toBe('org/repo')
    expect(projectName(`${home}/other/place`)).toBe('other/place')
  })

  it('never leaks the user name for paths directly under home', () => {
    expect(projectName(`${home}/solo`)).toBe('solo')
  })

  it('handles paths outside home and missing cwd', () => {
    expect(projectName('/srv/app')).toBe('srv/app')
    expect(projectName('/app')).toBe('app')
    expect(projectName(undefined)).toBe('(unknown project)')
  })
})

describe('redact', () => {
  it('masks common token shapes and emails, leaves prose alone', () => {
    expect(redact('sk-abcdefghijklmnopqrstuvwxyz')).toBe('[redacted]')
    expect(redact('AKIAIOSFODNN7EXAMPLE')).toBe('[redacted]')
    expect(redact('xoxb-1234567890-abcdef')).toBe('[redacted]')
    expect(redact('a'.repeat(40))).toBe('[redacted]')
    expect(redact('Fix the LazyColumn recomposition bug')).toBe('Fix the LazyColumn recomposition bug')
  })
})

describe('isPlumbing', () => {
  it('recognises Claude Code plumbing stored as user messages', () => {
    for (const t of [
      '<bash-input>cp a b</bash-input><bash-stdout>ok</bash-stdout>',
      '<command-name>/login</command-name> <command-message>login</command-message>',
      '<local-command-stdout>Goodbye!</local-command-stdout>',
      '<system-reminder> This conversation is now continuing in the Claude desktop app',
      '<ide_opened_file>foo.ts</ide_opened_file>',
    ]) {
      expect(isPlumbing(t), t).toBe(true)
    }
  })

  it('leaves real prompts alone, including ones mentioning tags or files', () => {
    for (const t of [
      'Explain how <div> nesting affects layout in this component',
      '@"/Users/me/spec.md" read this and build it',
      '> quoted output from a tool, then my question about it',
    ]) {
      expect(isPlumbing(t), t).toBe(false)
    }
  })
})

describe('redact email rule', () => {
  it('does not treat package@version as an email', () => {
    expect(redact('> raincheck@0.1.0 check:live')).toBe('> raincheck@0.1.0 check:live')
    expect(redact('mail me at someone@example.co.jp please')).toBe('mail me at [redacted] please')
  })
})
