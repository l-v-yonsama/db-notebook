# パフォーマンスチューニングの使い方

## できること

Database Notebookでは、遅いSQLに対して実行計画、関連テーブルの統計・インデックス・物理状態をまとめて確認できます。対応するデータベースでは、実際にSQLを実行して得た実測計画も確認できます。

主な用途は次のとおりです。

- 実行計画と実測行数の差を確認する
- インデックスや統計、メンテナンス状態の手掛かりを確認する
- Copilotまたは外部AIに、収集済みの根拠を渡して改善案を求める
- 分析結果をDBN／HTMLレポートとして保存する

## 開始する

SQL HistoryまたはQuery Statisticsから、対象SQLのパフォーマンスチューニングPreviewを開きます。

SQLにプレースホルダーがある場合は、代表的なバインド値を入力します。入力値は計画取得だけに利用され、保存設定には書き込みません。

Previewでは、最初に見積り計画と関連メタデータを収集します。`Status: complete` は必要な収集が完了したことを示します。`partial` の場合は、`Collection issues` で取得できなかった情報と影響を確認してください。

## 画面の読み方

### Performance snapshot

AIとは別に、収集結果から決定的に作られた要約です。

- `Evidence: Estimate only` は見積り計画のみです。
- `Evidence: Actual measured` は実測値があります。
- `Observed signals` は見積り精度やテーブル保守状態の手掛かりです。
- `Table row flow` は、テーブル全体、アクセス対象、フィルタ通過後、計画出力の行数を並べます。

`Access fraction` はテーブル全体のうちアクセス対象になった割合です。`Filter pass rate` は、そのアクセス対象のうちフィルタを通過した割合です。両者は別の指標です。

### Collection issues と Information

`Collection issues` は、権限不足や取得上限などにより分析精度へ影響する情報です。必要ならSuggested actionとTechnical detailsを確認してください。

`Information` は、filesortや一時表などの計画上の特徴です。単独では問題の確定を意味しません。

### Execution plan

実測がある場合は、実測根拠を優先して表示します。

- PostgreSQLは正規化実行計画に実測時間・行数が含まれます。
- MySQL、Oracle、SQL Serverは、ベンダー固有のActual execution planを別途表示する場合があります。
- `Table metrics` では、見積り行数・実測行数・比率とフィルタ指標を比較できます。

## Run Explain Analyze

`Run Explain Analyze` は、対象SQLを実際にデータベースで実行します。読み取りでも負荷やロック待ちが発生し得るため、確認ダイアログの内容を確認してから実行してください。

- 単一SELECTだけが対象です。
- INSERT、UPDATE、DELETEは見積り計画のみです。
- 成功すると、警告表示が消え、`Evidence: Actual measured` と実測計画・実測指標が表示されます。

本番環境での実行は、対象SQLの負荷と運用ルールを確認したうえで行ってください。

## AIで分析する

1. 必要なら先に `Run Explain Analyze` を実行します。
2. Language modelを選択します。
3. 日本語で回答を受けたい場合は `Translate response` を有効にします。
4. `Analyze with AI` を選択します。

AIの回答にはSummary、Findings、Recommendations、Missing contextが含まれます。推奨SQLは自動実行されません。DDLや書き換えSQLは、テスト環境・実行計画・影響範囲を確認してから実行してください。

Copilot以外を使う場合は `Copy Prompt for Other AI` を選択し、ChatGPT、Claude、Codexなどへ貼り付けます。Translate responseが有効な場合は、コピーされるプロンプトにも回答言語の指定が含まれます。

## 保存して共有する

AI分析が成功した後、`Save as Notebook` を選択すると、ワークスペースの `reports/performance-tuning/` にDBNが作成されます。

保存したDBNには次が含まれます。

- SQLとPerformance snapshot
- Collection issues / Information
- SQLに絞ったER図と関連インデックス
- 実行計画と実測計画
- AI分析結果
- Full context JSON、AI request messages、AI analysis JSON

DBNをHTML出力すると、MermaidのER図と整形済みの実測計画をブラウザで確認できます。
