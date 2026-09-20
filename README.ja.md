# raincheck

> Every bookmark is a rain check. Find the ones worth redeeming today.

English: [README.md](README.md)

Raindrop に溜めたブックマークのうち、最近の Claude Code の作業と照らし合わせて、いま読む価値があるものだけを表示する CLI です。

判定は [Jev](https://docs.typesafe.ai) が行います。記事ごとに「主題がいまの作業にどれだけ近いか」「読むといまの作業がどう変わるか」を段階で返し、その組み合わせで「助けになるもの」「関連するもの」「出さない」に分けます。

## インストール

Node 22.18 以上。

```sh
npm install
npm link
```

## 認証情報

TypeSafe の API key と Raindrop の test token が必要です。

- TypeSafe: [https://typesafe.ai](https://typesafe.ai)
- Raindrop: [https://app.raindrop.io/settings/integrations](https://app.raindrop.io/settings/integrations) でアプリを作成し、test token をコピー

```sh
raincheck configure
```

環境変数 `TYPESAFE_API_KEY` と `RAINDROP_TOKEN` があれば、ファイルよりそちらが優先されます。

Raindrop の test token はアカウント全体の権限を持ちます。読み取り専用のスコープは無いので、パスワードと同じ扱いで保護してください。

## 使い方

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

URL の下の 1 行は、読むのにかかる労力です。どちらの節に入るかの決まりは [Questions](#questions) を参照してください。

| フラグ               | 意味                                                                   |
| ----------------- | -------------------------------------------------------------------- |
| `--top N`         | 各節に表示する記事の件数の上限（既定: 全件）                                           |
| `--limit N`       | Raindrop から取得する記事の件数。新しい順（既定: 全件）                                    |
| `--days N`        | Claude Code のセッションを遡る日数（既定 7）                                        |
| `--current`       | 実行元の Claude Code セッション 1 つだけを、期間を区切らず使う。`--days` の代わり。[セッションの中から](#セッションの中から) を参照 |
| `--jsonl`         | 出力を JSONL にする。表示しない記事も含み、確率をすべて持つ                                    |
| `--collection=ID` | 取得する Raindrop のコレクション。`0` = 全件、`-1` = Unsorted（既定 0）。負の ID は `=` で指定 |
| `--concurrency N` | Jev へのリクエストの並列数（既定 10）                                        |

### 既定値

`--current` と `--jsonl` 以外のフラグは `~/.config/raincheck/config.json` で既定値を変えられます。コマンドラインのフラグが優先です。

```json
{ "days": 14, "top": 5 }
```

### セッションの中から

Claude 自身にセッション内で実行させると、`--current` でそのセッション 1 つだけを判定材料にできます。

```sh
raincheck --current --top 5
```

セッションは Claude Code が設定する `CLAUDE_CODE_SESSION_ID` で特定します。普通のターミナルからは使えません。

## State

Jev へのリクエストは state（判定材料）と questions（質問）からなります。state は次の 2 つです。

### 最近の作業

`~/.claude/projects/` 以下の Claude Code セッションから組み立てた digest です。含まれるのは次の 3 つだけです。

- プロジェクトごとのブランチ名とセッション数
- 各セッションの AI 生成タイトル
- あなた自身のプロンプトの抜粋

assistant の出力、tool の結果、subagent の transcript、貼り付けた添付は読みません。認証情報らしき文字列はマスクします。ただしマスクはパターン一致による保険であって保証ではありません。

送られる内容は次のコマンドで確認できます。

```sh
raincheck context
```

### 記事

ブックマークのタイトル、説明文、あなたのメモ、ハイライト、タグ、ドメイン。URL と保存日時は送りません。

URL が digest に残ったプロンプトに出てくる記事は、すでに読んだものとみなして Jev に送らず、`consulted` として除外します（`raincheck context` で見える範囲のプロンプトが対象です）。

## Questions

ブックマーク 1 件につき Jev へ 1 リクエストを送り、3 つの Score に答えさせます。質問は互いに独立で、記事同士を比較することはありません。

| 質問       | 段階（低 → 高）                                   | 用途 |
| ---------- | ------------------------------------------------- | ---- |
| `distance` | 無関係 / 隣接 / まさにこれ（記事の主題が、いま取り組んでいることそのもの） | **判定** |
| `effect`   | 変わらない / 選択に効く / そのまま使える（読んだ後、いまの作業がどう変わるか） | **判定** |
| `depth`    | タイトルで足りる / 短い / 腰を据える / 手を動かす（読む労力） | 表示のみ |

判定は、`distance` と `effect` それぞれで一番確率が高い段階を採り（同点なら低い方）、この表で引きます。閾値の数字はありません。

| distance ＼ effect | 変わらない | 選択に効く | そのまま使える |
| ------------------ | ---------- | ---------- | -------------- |
| 無関係             | 出さない   | 出さない   | 出さない       |
| 隣接               | 出さない   | 関連するもの | 関連するもの |
| まさにこれ         | 出さない   | 助けになるもの | 助けになるもの |

表示順は `distance` の段階、次に `effect` の段階、同点なら平均値の降順です。

質問文と表は [src/questions.ts](src/questions.ts) にあります。判定を変えたいときはこのファイルだけを編集します。

## 調整

「読みたいもの」を先に決めるのではなく、出てきたものを見て「不要」と、その理由を言葉にします。理由が段階の文言か表のマスになります。

1. 全件の判定結果を保存する

   ```sh
   raincheck --jsonl > verdicts.jsonl
   ```

2. 表示された記事のうち不要なものについて、なぜ不要かを書く（例: 主題が別、もう読んだ、俯瞰記事）
3. その理由を `src/questions.ts` の段階の文言か表に反映する
4. 同じ記事で取り直し、見比べる

   ```sh
   jq -r '[.levels.distance, .levels.effect, .decision, .bookmark.title] | @tsv' verdicts.jsonl | sort -rn
   ```

外れの原因が digest にあるときは `raincheck context` を読んで `--days` を変えるか、`--current` でいまのセッションに絞ります。

## 開発

```sh
npm test             # ユニットテスト
npm run typecheck    # 型検査
npm run lint         # Biome: lint、フォーマット検査、import の並び
npm run lint:fix     # Biome が自動で直せるものを適用
npm run check:live   # 各 API を 1 回ずつ実際に叩く
```

## ライセンス

[MIT](LICENSE)