# RPC 利用ガイド

[English](./databaseNotebookRPC.md)

Database Notebook では、gRPC サーバーのメソッドを **Invoke RPC パネル**から呼び出すか、`.dbn` ノートブックの **RPC JSON** セルとして保存・実行できます。どちらも unary、server streaming、client streaming、bidi streaming に対応します。ノートブックには SQL セルと RPC セルを混在させられます。

## 1. 接続を作成する

1. **DB Explorer** で接続定義を追加し、種類に **RPC**（ツリー上では gRPC）を選びます。接続名、Host、Port を入力します。
2. **Definition source** を選びます。
   - **Server Reflection**: サーバーからサービスとメッセージ定義を取得します。サーバー側で reflection が有効になっている必要があります。
   - **Local proto**: `.proto` ファイルの絶対パスを指定します。import がある場合は **Proto include directories** に検索先を 1 行ずつ追加します。必要に応じて **Verify local proto with server reflection** を有効にできます。
3. 認証は **No authentication (plaintext)** または **TLS + Bearer token** を選びます。後者では Bearer token を入力し、必要な場合だけ CA 証明書を指定します。
4. 必要に応じて **Stream deadline (ms)** を設定します。初期値は 300000 ms（5 分）、`0` は期限なしです。**Response JSON: Show default values** は表示上の設定であり、値が送信・保存されたことを意味しません。
5. 接続を保存し、DB Explorer で展開します。パッケージ、サービス、メソッド、リクエスト／レスポンスの Message とフィールドを確認できます。項目を選ぶと **Resource Properties** に属性が表示されます。

## 2. Invoke RPC パネルから呼び出す

DB Explorer でメソッドの **Invoke RPC** アイコンまたは右クリックメニューを使います。パネルの左側が **Request**、右側が **Response** です。

- Request の **Data** に ProtoJSON のオブジェクトを入力します。**Metadata** は省略可能な JSON オブジェクトで、値には文字列または文字列配列を指定します。`authorization` は接続定義で管理するため、ここには入力できません。**Description** でメッセージ定義を確認できます。
- unary と server streaming は Data を 1 件入力して **Invoke** します。
- client streaming と bidi streaming は **Start** でストリームを開き、Data に次のメッセージを入力して **Send** を必要な回数だけ押します。**Finish Sending** は送信側を閉じて応答を待ちます。途中で止めるときは **Cancel** を使います。
- Response の **Data / Headers / Trailers / Description** を切り替えて確認できます。結果があるときは **Output HTML** でレポートを保存できます。

例として、リクエスト Message に `id` フィールドがあるメソッドの Data は次のように入力します。

```json
{
  "id": 26
}
```

Metadata を指定する場合は、別のタブに例えば `{ "x-request-id": "example" }` と入力します。

ProtoJSON では、64-bit 整数は応答では文字列になります。リクエストには安全な範囲の数値も指定できます。Timestamp と Duration は文字列、bytes は base64 文字列を使用します。

## 3. ノートブックの RPC セルで実行する

DB Explorer のメソッドから **Add RPC Request Cell to Notebook** を選ぶと、そのメソッドのセルを追加できます。通常のコードセルを作り、右端の言語選択から **RPC JSON**（`rpc-json`）に切り替える方法もあります。後者ではセルのステータスバーから接続とメソッドを選んでください。

セル本文には **Request Data だけ**を、エスケープのない JSON で書きます。`dataJson` というキーや JSON を文字列化した値は不要です。unary と server streaming では 1 個の JSON オブジェクトを指定します。

```json
{
  "id": 26
}
```

client streaming と bidi streaming では、送信するメッセージを **オブジェクトの配列**で指定します。セル実行時に配列順で送信し、送信を終了して応答を待ちます。パネルのように送信時刻を 1 件ずつ手動で決める操作はありません。

```json
[
  { "value": "first" },
  { "value": "second" }
]
```

セルのステータスバーにある **Edit metadata / Show descriptor** から設定パネルを開けます。**Metadata** にリクエストのメタデータを JSON オブジェクトで入力し、**Save** します。例えば `{ "x-request-id": "example" }` と入力できます。空の `{}` はメタデータなしとして扱います。**Descriptor** では選択したメソッドの定義を確認でき、**Reload schema** と **Insert request template** も使えます。Metadata はセル出力ではなくセルの設定なので、実行結果を消しても残ります。Descriptor は設定パネルから再度表示できます。

実行結果にはステータス、所要時間、送受信件数と、**Data / Headers / Trailers** のタブが表示されます。ノートブック上部の **Output HTML** から、RPC セルのリクエストと最後の実行結果を含む HTML レポートを出力できます。

> セルの言語を RPC JSON に切り替えても、以前の SQL や JSON セルの本文・設定は RPC 用に自動変換されません。RPC の接続、メソッド、本文を設定してください。

## 4. Histories から再利用する

**Histories** ビューにはクエリと RPC の履歴が一緒に表示されます。ストリーミングはメッセージごとではなく、1 回の呼び出しが 1 件の履歴です。同じ接続・メソッド・リクエスト本文の再実行は 1 件にまとめられ、実行回数が表示されます。Request Metadata の違いはまとめる単位に含みません。

| 履歴の種類 | 利用できる操作 |
| --- | --- |
| unary / server streaming、本文あり | **Execute**、**Open in RPC Panel**、**Open as notebook**、**Append to active notebook**、**Delete** |
| unary / server streaming、本文なし | **Open in RPC Panel**、**Delete**。パネルには現在のメソッドのテンプレートが開き、過去の本文は復元されません。 |
| client / bidi streaming、本文あり | **Open as notebook**、**Append to active notebook**、**Delete**。配列の送信内容を持つため、パネルでの復元・再実行には対応しません。 |
| client / bidi streaming、本文なし | **Delete** |

本文の保存上限は 64 KiB です。上限を超えた履歴では本文を使う操作を利用できません。Metadata は空でない場合だけ、保存されたリクエストと一緒に復元されます。成功後の再実行に失敗した場合は、直前の成功結果に対応する本文と Metadata が残り、失敗は別途記録されます。履歴の行をクリックするだけでは操作は起きません。右クリックメニュー、または利用可能な行のホバーアイコンを使ってください。ビュー上部の削除操作はクエリと RPC の履歴をまとめて削除します。

## 5. AI ツールから RPC を使う

先に RPC 接続で AI ツールからの利用を有効にしてください。Copilot Chat とローカル MCP サーバーの `getDbSchema` で、サービス・メソッド名、呼び出し種別、リクエストとレスポンスの Descriptor、ProtoJSON の入力例を参照できます。`serviceName` と `methodName` で対象を絞れます。

Copilot Chat のノートブック作成・編集ツールは `rpc-json` セルに対応します。セル本文には unary/server streaming なら ProtoJSON オブジェクト、client/bidi streaming ならオブジェクトの配列を指定します。`metadata.rpc.service` と `metadata.rpc.method` を設定し、送信 Metadata が必要なら `metadata.rpc.metadata` に指定します。メソッドの path と呼び出し種別は Descriptor から設定されます。セルの作成・編集時には RPC を実行しません。

`invokeUnaryRpc` は Copilot Chat または MCP から unary RPC を直接実行します。送信前にリクエストと Metadata のローカル確認を求め、結果を Histories に記録し、レスポンスには接続の AI マスキング設定を適用します。AI から streaming を実行する場合はノートブックセルを使ってください。
