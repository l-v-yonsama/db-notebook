# ダッシュボード利用ガイド

[English](dashboard.md)

> **Experimental（実験的機能）:** ダッシュボードの提供範囲、メトリクス、UI の挙動、保存されるレポート形式は今後変更される可能性があります。運用上重要な判断に利用する場合は、データベースまたは AWS コンソールでも確認してください。

Database Notebook のダッシュボードは、DB Explorer からデータベースの稼働統計と AWS CloudWatch メトリクスを調査するための機能です。対話的な調査を目的としており、24 時間 365 日の継続監視を行う機能ではありません。

## 対応するダッシュボード

### データベースダッシュボード

対応する MySQL、PostgreSQL、SQL Server、SQLite、Oracle のデータベースリソースで利用できます。表示されるパネルは、データベースエンジン、バージョン、権限、接続先により異なります。

ダッシュボードでは、次のような情報を表示します。

- ワークロードの rate と現在のアクティビティ
- wait、lock、session の概要
- I/O、cache、storage、capacity の統計
- configuration または現在状態の値
- 収集時の notice、取得できないメトリクス、統計 reset marker

### CloudWatch メトリクスダッシュボード

DynamoDB table、S3 bucket、SQS queue、CloudWatch Logs log group、SES、および DB Explorer が提供する service overview node など、対応する AWS リソースで利用できます。

リソースで処理が発生した場合だけ出力されるメトリクスや、追加の AWS 設定が必要なメトリクスがあります。たとえば、一部の S3 request metrics は opt-in です。また、CloudWatch API の読み取りに AWS 利用料金が発生する場合があります。

## ダッシュボードを開く

1. Database Notebook サイドパネルの **DB Explorer** を開きます。
2. データベースまたは AWS 接続へ接続し、ツリーを展開します。
3. ダッシュボードに対応するリソースを右クリックします。
4. 表示されたコマンドを選択します。
   - **Show database dashboard**
   - **Show CloudWatch metrics**
   - **Show CloudWatch metrics overview**

選択したリソースが対応する dashboard capability を持つ場合だけ、メニュー項目が表示されます。

## データベースの sampling

データベースダッシュボードを開くと、最初の snapshot を 1 回取得します。周期的な sampling は自動では開始されません。

- sample interval を選択し、**Start sampling** を押すと時系列履歴を収集します。
- **Stop sampling** を押すと、最後の chart を残したまま収集を停止します。
- **Refresh now** で 1 回だけ即時取得できます。
- ダッシュボードを非表示にすると周期 sampling は停止します。履歴の収集を続ける場合は、表示へ戻った後に再度開始してください。

database sampling には専用 observer connection と read-only の監視 query を使用します。一部の global counter には observer 自身の処理が含まれる場合があり、対象 series にはその状態を表示します。短い interval ほど、observer の相対的な影響とデータベース負荷が大きくなります。

## CloudWatch の更新とコスト

**Refresh** を押すと、選択した CloudWatch time range を取得します。一部のダッシュボードでは auto refresh も利用できます。toolbar には、1 回の更新で要求する metric series 数を cost indicator として表示します。

ダッシュボードが AWS メトリクスを有効化したり、リソース設定を変更したりすることはありません。欠損、遅延、取得不能の datapoint は 0 へ変換せず、状態または notice として表示します。

## 状態と reset marker

- **Partial / unavailable:** 権限、バージョン、接続先、source 設定などにより、一部のメトリクスを取得できません。
- **Warming up:** 累積 counter から rate を計算するため、次の sample が必要です。
- **Statistics reset / server restart:** counter の baseline が変わった位置を縦線で表示します。reset をまたいで線を結びません。
- **Observer impact:** series ごとに observer query の影響が included、excluded、unknown のどれかを表示します。

## ダッシュボードレポートへの出力

**Export to Notebook** を押すと、ダッシュボードに表示済みのデータを読み取り専用 `.dbnr` レポートとして保存します。出力時にデータベース query や CloudWatch request を再実行することはありません。

レポートは、最初に開いている workspace folder の次の場所へ保存されます。

- CloudWatch: `reports/cw-metrics/`
- データベースダッシュボード: `reports/rdb-dashboard/`

レポートには summary、metric series、diagnostics が含まれます。データベースレポートでは、reset marker や値を取得できなかった series も調査証跡として保存します。認証情報、接続文字列、SQL text、driver の raw error は保存しません。
