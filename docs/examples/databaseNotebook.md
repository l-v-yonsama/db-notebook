# Database Notebook examples

This page shows an example of the use of the VS code extension "Database Notebook".

## TOC

- 1. [Query examples](#1-query-examples)
  - 1.1. [Bind parameters in query](#11-bind-parameters-in-query)
  - 1.2. [Variable sharing advanced examples (LIKE / IN)](./databaseNotebookVariableSharing.md)
- 2. [Controlling the Database with Javascript](#2-controlling-the-database-with-javascript)
  - 2.1. [Inserting parent and child records in the same transaction](#21-inserting-parent-and-child-records-in-the-same-transaction)
- 3. [Multi-language flow: SQL → JavaScript → Markdown](#3-multi-language-flow-sql--javascript--markdown)
- 4. [DynamoDB Query Result](#4-dynamodb-query-result)
  - 4.1. [Dynamo Query Panel: Projection, consistent read, and Query History](#41-dynamo-query-panel-projection-consistent-read-and-query-history)

## 1. Query examples

SQL statements can be issued by specifying "SQL" as the language of the cell.

### Define cells.

```sql
SELECT customer_no, age FROM customer WHERE age IN (10, 20, 30) ORDER BY customer_no
```

### Execution Result.

`[Query Result]` 3 rows in set (0.00 sec)
| ROW | customer_no | age |
| ---: | ---: | ---: |
| 1 | 7566 | 10 |
| 2 | 7698 | 30 |
| 3 | 7782 | 20 |

### 1.1. Bind parameters in query

> **More examples**
>
> For more practical examples of bind parameters — including
> exact match, partial match (`LIKE`), and `IN (:list)` patterns —
> see the following document:
>
> - [Variable sharing between notebook cells – LIKE and IN examples](./databaseNotebookVariableSharing.md)

#### Define cells.

Cell[1] Defines the shared values within the notebook in the "JSON" language.

```json
{
  "customer_no": 7600,
  "age_list": [10, 20, 30]
}
```

Cell[2] Defines the query within the notebook in the "SQL" language.

Colon + variable name to specify bind variables.

```sql
SELECT customer_no, age FROM customer
WHERE age IN ( :age_list ) AND customer_no > :customer_no
```

### Execution Result.

Cell[1] (JSON variables cell)

OK: updated 2 variables

Cell[2] (SQL cell)

`[Query Result]` 2 rows in set (0.00 sec)
| ROW | customer_no | age |
| ---: | ---: | ---: |
| 1 | 7698 | 30 |
| 2 | 7782 | 20 |

## 2. Controlling the Database with Javascript

> **No hosted API reference for `DBDriverResolver`/`normalizeQuery`**
>
> These (and the other globals available in JS cells, like `variables` and
> `writeResultSetData`) don't have a hosted API reference page right now. Hover over
> them, or trigger signature help inside their parentheses, for the exact real types
> and parameters. See also the
> [Implicit Globals Quick Reference](./databaseNotebookJs.md#implicit-globals-quick-reference).

### 2.1. Inserting parent and child records in the same transaction

#### Define cells.

```js
// Get a connection definition by specifying the "Connection name" defined in the "DB Explorer".
const connectionSetting = getConnectionSettingByName("localPostgres");

const { ok, message, result } = await DBDriverResolver.getInstance().flowTransaction(
  connectionSetting,
  async (driver) => {
    // for PostgreSQL
    const { rows } = await driver.requestSql({
      sql: "INSERT INTO order1 (customer_no, order_date, amount) VALUES (10, '2024-01-01', 300) RETURNING order_no AS inserted_no",
    });
    const orderNo = rows[0].values["inserted_no"];

    // for MySQL
    // const { summary } = await driver.requestSql({sql:"INSERT INTO testdb.order (customer_no, order_date, amount) VALUES (10, '2024-01-01', 300)"});
    // const orderNo = summary.insertId;

    for (let i = 1; i <= 3; i++) {
      const { query, binds } = normalizeQuery({
        query:
          "INSERT INTO order_detail (order_no, detail_no, item_no, amount) VALUES (:order_no, :detail_no, :item_no, :amount)",
        bindParams: { order_no: orderNo, detail_no: i, item_no: i * 50, amount: 100 },
        toPositionedParameter: driver.isPositionedParameterAvailable(),
        toPositionalCharacter: driver.getPositionalCharacter(),
      });
      await driver.requestSql({ sql: query, conditions: { binds } });
    }

    return `Inserted order_no is ${orderNo}`;
  },
  { transactionControlType: "rollbackOnError" }
);

console.log("ok", ok);
console.log("message", message);
console.log("result", result);
```

#### Execution Result.

```text
ok true
message
result Inserted order_no is 25
```

## 3. Multi-language flow: SQL → JavaScript → Markdown

Because SQL, JavaScript, and Markdown cells live in the same notebook file and can share variables, a single notebook can query data, process it, and document the result — all in one place, without exporting anything to another tool.

Two things to know before wiring cells together like this:

- `variablesCell.setKeyValueAtFirst(key, value)` (used in the JavaScript cell below) always writes into the **first JSON cell in the notebook** (see `isJsonValueCell`/`applyJsonCellValueUpdates` in `src/notebook/controller.ts`). The notebook needs at least one JSON cell for this to work — even an empty `{}` one, as in Cell[1] below — or it throws `JSON cell index[0] is out of range[0]`.
- A cell whose result is saved via "Saving execution results in shared variables" is stored as `{ success, stdout, stderr, skipped, status, metadata }` (`src/notebook/controller.ts:498-506`), not as the raw result. This is intentional — without `success`/`status`, a later cell reading the variable would have no way to tell whether the source cell actually ran successfully. This is different from a plain JSON-cell variable (see [1.1](#11-bind-parameters-in-query)), which is just the value itself, so always check `success` before reading `metadata` here.

### Define cells.

Cell[1] Defines an (initially empty) shared-variables cell in the "JSON" language — the target `variablesCell.setKeyValueAtFirst()` in Cell[3] writes into.

```json
{}
```

Cell[2] (SQL cell) — query customer ages, then save the result set as a shared variable.

Open the cell's metadata settings (`Show metadata settings`), check **Save** under "Saving execution results in shared variables", and set the shared variable name to `ageStats`.

```sql
SELECT customer_no, age FROM customer WHERE age IN (10, 20, 30) ORDER BY customer_no
```

Cell[3] (Javascript cell) — read the SQL cell's result via the shared variable and compute a summary.

```js
const { success, metadata } = variables.get("ageStats");
if (success) {
  const { rdh } = metadata;
  const ages = rdh.rows.map((row) => row.values["age"]);
  const average = ages.reduce((a, b) => a + b, 0) / ages.length;

  console.log(`Average age of ${ages.length} customers: ${average.toFixed(1)}`);
  variablesCell.setKeyValueAtFirst("averageAge", average.toFixed(1));
}
```

Cell[4] (Markdown cell) — document the finding next to the cells that produced it.

```markdown
## Findings

The query above returned 3 customers. The average age (computed in the previous JavaScript
cell) was **20.0**. See `averageAge` in the notebook's shared variables for the latest value.
```

### Execution Result.

Cell[1] (JSON variables cell) — after Cell[3] runs, its content is rewritten to:

```json
{
  "averageAge": "20.0"
}
```

```text
OK: updated 0 variable
```

Cell[2] (SQL cell)

`[Query Result]` 3 rows in set (0.00 sec)
| ROW | customer_no | age |
| ---: | ---: | ---: |
| 1 | 7566 | 10 |
| 2 | 7698 | 30 |
| 3 | 7782 | 20 |

Cell[3] (Javascript cell)

```text
Average age of 3 customers: 20.0
```

## 4. DynamoDB Query Result

A DynamoDB PartiQL `SELECT` (Notebook cell) or a native `Query` (Dynamo Query Panel) shows a
different `[Query Result]` line than the RDB examples above — item-based wording instead of
`rows in set`, and only the fields DynamoDB actually reported. (The Panel currently drives only
native `Query`, which requires a partition key condition.)

```text
[Query Result] 38 items returned • 90 ms • Capacity not reported
```

```text
[Query Result] 25 returned / 100 evaluated • 42 ms • 1.5 RCU • 25% pass
```

A few things about this line are easy to misread:

- **`requests`, when shown, is not how many times you ran the statement.** It's how many DynamoDB
  API responses the driver fetched *within that one execution* — a single large `SELECT` can span
  multiple responses (the result exceeds the 1 MB per-response limit) that are fetched and merged
  automatically.
- **PartiQL never reports an evaluated-item count.** `ExecuteStatement` (what PartiQL runs as) has
  no `ScannedCount` in its response, so a PartiQL result only ever shows the returned count
  (`N items returned`), never a `returned / evaluated` split.
- **A native `Query` can report both.** When it does, the line shows
  `returned / evaluated` plus the filter pass rate (`returned ÷ evaluated`) — useful for seeing how
  much of what DynamoDB read was actually discarded by a `Filter`.
- **`Capacity not reported` does not mean zero Capacity was consumed.** It means DynamoDB (or a
  compatible endpoint, e.g. DynamoDB Local) didn't return Consumed Capacity for that request at
  all. An explicit `0 RCU`/`0 WCU`/`0 CU` — a real, reported zero — is shown differently and is not
  confused with this case.
- **`Result limited; additional items exist` means the result you're looking at is not the full
  result.** It appears whenever the driver stopped with more data still available (most commonly a
  `LIMIT` cutting off before DynamoDB ran out of items) — there's no "fetch next page" action in the
  Notebook today, so this is a signal to add/raise a `LIMIT` or narrow the key condition rather than
  an indication anything went wrong.

### 4.1. Dynamo Query Panel: Projection, consistent read, and Query History

Open the Dynamo Query Panel from a table's resource-tree context menu. Beyond the target
(table/LSI/GSI), partition/sort key, sort direction, and filter expressions already covered above,
it also has:

- **Returned attributes (Projection)** — `Default for target` (leaves `Select`/`ProjectionExpression`
  unset, so DynamoDB returns every attribute for a table or every projected attribute for an index),
  `Specific attributes` (an explicit list, aliased automatically so a reserved word or a name with
  spaces/symbols is never interpolated as-is), or, LSI only, `All table attributes`
  (`Select: "ALL_ATTRIBUTES"`). A narrower Projection reduces the returned payload — for a table
  Query it does **not** reduce Read Capacity, since the same items are still read. Choosing an
  attribute the target index doesn't itself project is marked with a warning: on an LSI it's still
  allowed (DynamoDB may fetch it from the base table, adding latency/Capacity), while a GSI simply
  can't return it and the panel won't let you select it.
- **Strongly consistent read** — available for the table or an LSI, always off (and disabled) for a
  GSI, which can't use one at all. Switching the target to a GSI clears both the checkbox and any
  Projection selection it made invalid, on the host side, not only in the panel's own UI.
- **Max returned items** — the renamed `Limit` field. The panel may issue more than one `Query`
  request; this caps the items kept in the combined result, not a single request's own `Limit`
  parameter or how many items DynamoDB evaluates across every request it makes.
- **Build** — switches the Preview between the default native Query input and a standalone PartiQL
  `SELECT`. `Execute` intentionally remains a native Query in either mode so its Query History result
  retains DynamoDB `Count`/`ScannedCount`. In PartiQL mode, **Open in Notebook** can add the generated
  statement to a new or active Notebook; the action is disabled in Native Query mode. Read
  consistency is an API option rather than PartiQL statement text, so that one option is not carried
  into the generated SQL cell.

Every execution — successful or failed — is saved to **Query History** automatically, labeled with an
item count instead of a row count and no attached SQL (there is nothing equivalent to run as a SQL
cell). Native Query history therefore does not show the generic Query History Notebook actions; use
**Open in Dynamo Query Panel** to inspect or edit it instead. Re-running the same
table/index/key-condition/filter/Projection/consistency
structure with different partition/sort key values merges into that one history entry — the newest
values are kept for `Execute`, but never shown in the entry's label, tooltip, or **Performance
Tuning** preview (see [Performance Tuning Guide](performanceTuning.md#8-dynamodb)). A failed re-run
never overwrites the prior successful result; only its error is recorded alongside it.

For a native Query entry created by this panel, choose **Open in Dynamo Query Panel** from SQL
History (or use its edit icon). The panel restores the recorded table/LSI/GSI target, maximum item
count, partition and sort-key conditions, sort direction, filters, Projection, and consistent-read
choice. The restored values can be edited and executed as a new Query; if the recorded table or
index no longer exists, the panel reports that mismatch instead of silently switching targets.
