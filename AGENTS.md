# AGENTS.md

CLI that judges Raindrop bookmarks against recent Claude Code sessions using Jev (TypeSafe). Usage and setup are in [README.md](README.md).

## Commands

```sh
npm test             # unit tests; no network
npm run typecheck    # tsc --noEmit; nothing checks types at run time
npm run lint         # biome check: lint, format, import order; read-only
npm run lint:fix     # biome check --write; safe fixes only
npm run check:live   # hits the real Raindrop and TypeSafe APIs; needs credentials and costs money
```

Run `npm test`, `npm run typecheck`, and `npm run lint` before committing.

## Runtime

Node 24 runs the TypeScript source directly, so only erasable syntax is allowed (`erasableSyntaxOnly`): no `enum`, no constructor parameter properties, no decorators. Relative imports carry the `.ts` extension. Type-only imports use `import type`.

## Structure

- `src/types.ts` defines `Bookmark`, `RecentWork`, `Verdict`, and the four boundaries: `BookmarkSource`, `InterestSource`, `JevAsker`, `Sink`. It imports nothing from `src/`.
- `src/run.ts` depends only on those boundaries plus `decide.ts` and `questions.ts`. It never imports an adapter.
- Adapters (`raindrop/`, `jev/`, `interests/`, `sinks/`) never import each other. `cli.ts` assembles them.
- `src/questions.ts` is the whole judgment policy: questions, state shape, the outcome table. Do not put question text or outcome rules anywhere else.
- `src/decide.ts` turns answers into a verdict: which level a Score lands on, the `OUTCOME` lookup, the `consulted` rule, ranking. It is pure; keep it free of I/O and clocks.
- `src/config.ts` owns both files under `~/.config/raincheck/` (`credentials.json`: secrets, 0600; `config.json`: flag defaults) and the whole option pipeline: `OPTIONS` is the one rule a flag and its file key are both checked against, and `resolveOptions` merges flag > file > `DEFAULTS`. A new tunable goes there; `cli.ts` only passes `parseArgs` output through.

## Constraints

- Tests never reach the network. Every adapter takes an injectable `fetch`; fixtures live in `test/fixtures/`.
- `src/interests/claude-sessions.ts` may read only the person's own prompts, session titles, and cwd/branch from `~/.claude/projects/`. Assistant output, tool results, attachments, and subagent transcripts stay unread. Its output is sent to a third party.
- One Jev request per bookmark. Batching several bookmarks into one request was measured to flatten the relevance spread and break the ranking.
- Jev does not count, compare dates, or summarize. That logic stays in code.
- Question text is English; TypeSafe reports its best accuracy there. The state may be any language.
- Credentials come from the environment or `~/.config/raincheck/credentials.json`, never from arguments, source, or `config.json`.

## Conventions

- Comments explain why, not what. Exported symbols get JSDoc; internals get `//` only where the reason is not visible in the code. No change history in comments.
- Formatting and import order are Biome's (`biome.json`: defaults, spaces). Do not hand-format; run `npm run lint:fix`.
- Commit messages: Conventional Commits, in English, one logical change per commit, tests passing at every commit.
