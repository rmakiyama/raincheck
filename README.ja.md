# raincheck

> Every bookmark is a rain check. Find the ones worth redeeming today.

English: [README.md](README.md)

Raindrop に溜めたブックマークのうち、最近の Claude Code の作業と照らし合わせて、いま読む価値があるものだけを表示する CLI です。

判定は [Jev](https://docs.typesafe.ai) が行います。記事ごとに「最近の作業に関係するか」「すぐ使えるか」を確率で返し、閾値を超えたものを関連度の高い順に並べます。

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

judged 24, surfaced 3, failed 0, tokens in=95210 out=1150
```

記事ごとの数字は Jev の回答です。意味は [Questions](#questions) を参照してください。

| フラグ               | 意味                                                                   |
| ----------------- | -------------------------------------------------------------------- |
| `--top N`         | 表示する記事の件数の上限（既定: 閾値を超えた全件）                                           |
| `--threshold X`   | 表示する記事の `relevant` の下限。0〜1（既定 0.6）                                   |
| `--limit N`       | Raindrop から取得する記事の件数。新しい順（既定: 全件）                                    |
| `--days N`        | Claude Code のセッションを遡る日数（既定 7）                                        |
| `--jsonl`         | 出力を JSONL にする。閾値以下の記事も含み、確率をすべて持つ                                    |
| `--collection=ID` | 取得する Raindrop のコレクション。`0` = 全件、`-1` = Unsorted（既定 0）。負の ID は `=` で指定 |

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

## Questions

ブックマーク 1 件につき Jev へ 1 リクエストを送り、4 つの質問に答えさせます。質問は互いに独立で、記事同士を比較することはありません。

| 質問              | 型     | 内容                                | 用途              |
| --------------- | ----- | --------------------------------- | --------------- |
| `relevant`      | noul  | 記事は、最近の作業のプロジェクト・技術・問題に関係するか      | **判定**。閾値以上なら表示 |
| `actionable`    | noul  | 記事は、最近の作業にすぐ適用できる内容を含むか           | 並び順の同点処理        |
| `already_known` | noul  | 最近の作業に、記事が教えることをすでに実践している形跡があるか   | 記録のみ            |
| `depth`         | score | 記事から価値を得るのに、どれだけ腰を据える必要があるか（4 段階） | 記録のみ            |

表示順は `relevant` の降順、同点なら `actionable` の降順です。

質問文と閾値は [src/questions.ts](src/questions.ts) にあります。判定を変えたいときはこのファイルだけを編集します。

## 調整

1. 全件の判定結果を保存する

   ```sh
   raincheck --jsonl > verdicts.jsonl
   ```

2. 1 行ずつ「読みたい / 読みたくない」を手で付ける
3. `relevant` の値とラベルを突き合わせ、閾値を決める

   ```sh
   jq -r '[(.answers.relevant.noul*100|round), .decision, .bookmark.title] | @tsv' verdicts.jsonl | sort -rn
   ```

4. 外れている記事は、原因が digest か質問文かを切り分ける。digest なら `raincheck context` を読んで `--days` を変える。質問文なら `src/questions.ts` を直す

## 開発

```sh
npm test             # ユニットテスト
npm run typecheck    # 型検査
npm run check:live   # 各 API を 1 回ずつ実際に叩く
```

## ライセンス

[MIT](LICENSE)