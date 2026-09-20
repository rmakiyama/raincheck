# raincheck

> Every bookmark is a rain check. Find the ones worth redeeming today.

日本語: [README.ja.md](README.ja.md)

A CLI that picks, out of the bookmarks piling up in Raindrop, the ones worth reading now, judged against what you have been working on in Claude Code lately.

The judging is done by [Jev](https://docs.typesafe.ai). For each article it rates how close its subject is to your recent work and how much reading it would change what you are doing; the two ratings decide whether the article helps with your work, is merely related to it, or is not shown.

## Install

Node 22.18 or later.

```sh
npm install
npm link
```

## Credentials

You need a TypeSafe API key and a Raindrop test token.

- TypeSafe: [https://typesafe.ai](https://typesafe.ai)
- Raindrop: create an app at [https://app.raindrop.io/settings/integrations](https://app.raindrop.io/settings/integrations) and copy its test token

```sh
raincheck configure
```

The environment variables `TYPESAFE_API_KEY` and `RAINDROP_TOKEN`, when set, take precedence over the file.

The Raindrop test token grants access to your whole account. There is no read-only scope, so protect it as you would a password.

## Usage

```sh
raincheck --top 5
```

```
Helps with what you are doing now

AIと開発をした半年のメモ
  https://sizu.me/rmakiyama/posts/918kx38rrnid
  a short read

Agent Skillsと歩むAndroidのUI実装
  https://blog.kyash.co/entry/agent-skills-android-trial
  a sitting

Related to what you are doing now

抽象化とイラスト
  https://sizu.me/rmakiyama/posts/ts84sww1ezdw
  a short read

judged 24, helps 2, related 1, consulted 0, failed 0, model=jev-1.13.0, tokens in=95210 out=1150
```

The line under each URL is how much effort the article takes to read. Which section an article lands in is explained under [Questions](#questions).

| flag | meaning |
| --- | --- |
| `--top N` | show at most N articles per section (default: all) |
| `--limit N` | fetch at most N articles from Raindrop, newest first (default: all) |
| `--days N` | how many days of Claude Code sessions to look back (default 7) |
| `--current` | use only the Claude Code session the command is run from, whole, instead of the last `--days`. See [From inside a session](#from-inside-a-session) |
| `--jsonl` | output as JSONL instead: every article, including those not shown, with all probabilities |
| `--collection=ID` | which Raindrop collection to fetch. `0` = all, `-1` = Unsorted (default 0). Negative ids need the `=` form |
| `--concurrency N` | how many Jev requests to run in parallel (default 10) |

### Defaults

Any flag except `--current` and `--jsonl` can have its default set in `~/.config/raincheck/config.json`. A flag on the command line still wins.

```json
{ "days": 14, "top": 5 }
```

### From inside a session

When Claude runs raincheck inside its own session, `--current` judges against that one session alone:

```sh
raincheck --current --top 5
```

The session is found through `CLAUDE_CODE_SESSION_ID`, which Claude Code sets. From a plain terminal the flag fails.

## State

A request to Jev consists of state (the evidence) and questions. The state has two parts.

### Recent work

A digest built from the Claude Code sessions under `~/.claude/projects/`. It contains exactly three things:

- per project, its branch names and session count
- each session's AI-generated title
- excerpts of your own prompts

Assistant output, tool results, subagent transcripts, and pasted attachments are never read. Credential-shaped strings are masked, but the masking is pattern matching — a backstop, not a guarantee.

To see what will be sent:

```sh
raincheck context
```

### Article

The bookmark's title, description, your note, your highlights, tags, and domain. The URL and the saved date are not sent.

A bookmark whose URL appears in a prompt kept in the digest (what `raincheck context` shows) is treated as already read: it is not sent to Jev and is excluded as `consulted`.

## Questions

One request per bookmark, with three Score questions. The questions are independent of each other; articles are never compared with one another.

| question | levels (low → high) | used for |
| --- | --- | --- |
| `distance` | no contact / touches it / the subject itself (the article's main subject is what the person is working on) | **the decision** |
| `effect` | not at all / a choice is informed / applied as is (how the current work would change after reading) | **the decision** |
| `depth` | the title says it all / a short read / a sitting / hands-on (effort to get the value) | display only |

For `distance` and `effect` the most likely level is taken (the lower one on a tie) and looked up in this table. There is no threshold.

| distance \ effect | not at all | a choice is informed | applied as is |
| --- | --- | --- | --- |
| no contact | skip | skip | skip |
| touches it | skip | related | related |
| the subject itself | skip | helps | helps |

Articles are ordered by their `distance` level, then their `effect` level, then the two mean scores.

The wording of the questions and the table live in [src/questions.ts](src/questions.ts). To change how articles are judged, edit that file and nothing else.

## Tuning

Rather than deciding up front what you want to read, look at what came out and put into words why something is not needed. The reason becomes the wording of a level or a cell of the table.

1. Save every verdict

   ```sh
   raincheck --jsonl > verdicts.jsonl
   ```

2. For each shown article you do not need, write down why (the main subject is something else, already read, an overview piece)
3. Fold the reason into a level's wording or the table in `src/questions.ts`
4. Judge the same articles again and compare

   ```sh
   jq -r '[.levels.distance, .levels.effect, .decision, .bookmark.title] | @tsv' verdicts.jsonl | sort -rn
   ```

When the digest is at fault, read `raincheck context` and adjust `--days`, or narrow it to the session at hand with `--current`.

## Development

```sh
npm test             # unit tests
npm run typecheck    # type check
npm run lint         # Biome: lint, format check, import order
npm run lint:fix     # apply the fixes Biome can make on its own
npm run check:live   # one real call to each API
```

## License

[MIT](LICENSE)
