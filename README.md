# raincheck

> Every bookmark is a rain check. Find the ones worth redeeming today.

日本語: [README.ja.md](README.ja.md)

A CLI that picks, out of the bookmarks piling up in Raindrop, the ones worth reading now, judged against what you have been working on in Claude Code lately.

The judging is done by [Jev](https://docs.typesafe.ai). For each article it returns probabilities for "is this related to my recent work" and "can I apply it right away", and the articles above the threshold are listed by relevance.

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
3 of 24 worth cashing in today

AIと開発をした半年のメモ
  https://sizu.me/rmakiyama/posts/918kx38rrnid
  relevant=0.88  actionable=0.61  already_known=0.72  depth=1.4

Agent Skillsと歩むAndroidのUI実装
  https://blog.kyash.co/entry/agent-skills-android-trial
  relevant=0.79  actionable=0.55  already_known=0.36  depth=1.9

抽象化とイラスト
  https://sizu.me/rmakiyama/posts/ts84sww1ezdw
  relevant=0.63  actionable=0.18  already_known=0.11  depth=1.1

judged 24, surfaced 3, consulted 0, failed 0, model=jev-1.13.0, tokens in=95210 out=1150
```

The numbers under each article are Jev's answers. See [Questions](#questions) for what they mean.

| flag | meaning |
| --- | --- |
| `--top N` | show at most N articles (default: every article above the threshold) |
| `--threshold X` | show articles whose `relevant` is at least X, between 0 and 1 (default 0.6) |
| `--limit N` | fetch at most N articles from Raindrop, newest first (default: all) |
| `--days N` | how many days of Claude Code sessions to look back (default 7) |
| `--jsonl` | output as JSONL instead: every article, including those below the threshold, with all probabilities |
| `--collection=ID` | which Raindrop collection to fetch. `0` = all, `-1` = Unsorted (default 0). Negative ids need the `=` form |
| `--concurrency N` | how many Jev requests to run in parallel (default 10) |

### Defaults

Any flag except `--jsonl` can have its default set in `~/.config/raincheck/config.json`. A flag on the command line still wins.

```json
{ "days": 14, "top": 5 }
```

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

A bookmark whose URL appears in one of your prompts is treated as already read: it is not sent to Jev and is excluded as `consulted`.

## Questions

One request per bookmark, with four fixed questions plus one per project in the recent work. The questions are independent of each other; articles are never compared with one another.

| question | type | asks | used for |
| --- | --- | --- | --- |
| `relevant` | noul | does the article bear on the projects, technologies, or problems in the recent work | **the decision**: shown when at or above the threshold |
| `actionable` | noul | does the article contain something that can be applied to the recent work right away | tiebreak in ordering |
| `already_known` | noul | does the recent work show the article's substance already being practised | recorded only |
| `depth` | score | how much focused effort the article demands, on 4 levels | recorded only |
| `relevant_to::<project>` | noul | the `relevant` question, scoped to that one project | recorded only, to see whether `relevant` is diluted by the other projects |
| `distance` | score | how close the article is to the current work: unrelated / adjacent / on the work | recorded only; candidate to replace `relevant` + threshold |
| `effect` | score | how the current work would change after reading: not at all / informs a decision / applied right away | recorded only; same |

Articles are ordered by `relevant` descending, then by `actionable` descending.

The wording of the questions and the threshold live in [src/questions.ts](src/questions.ts). To change how articles are judged, edit that file and nothing else.

## Tuning

1. Save every verdict

   ```sh
   raincheck --jsonl > verdicts.jsonl
   ```

2. Mark each line by hand: want to read, or not
3. Compare `relevant` against your marks and pick the threshold

   ```sh
   jq -r '[(.answers.relevant.noul*100|round), .decision, .bookmark.title] | @tsv' verdicts.jsonl | sort -rn
   ```

4. For a miss, decide whether the digest or the question wording is at fault. If the digest, read `raincheck context` and adjust `--days`. If the wording, edit `src/questions.ts`

## Development

```sh
npm test             # unit tests
npm run typecheck    # type check
npm run check:live   # one real call to each API
```

## License

[MIT](LICENSE)
