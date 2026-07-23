# Database Notebook examples

This page shows an example of the use of the VS code extension "Database Notebook".

## TOC

- 1. [Query examples](#1-query-examples)
  - 1.1. [Bind parameters in query](#11-bind-parameters-in-query)
  - 1.2. [Variable sharing advanced examples (LIKE / IN)](./databaseNotebookVariableSharing.md)
- 2. [Controlling the Database with Javascript](#2-controlling-the-database-with-javascript)
  - 2.1. [Inserting parent and child records in the same transaction](#21-inserting-parent-and-child-records-in-the-same-transaction)
- 3. [Multi-language flow: SQL → JavaScript → Markdown](#3-multi-language-flow-sql--javascript--markdown)

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

### 2.1. Inserting parent and child records in the same transaction

#### Define cells.

```js
// Get a connection definition by specifying the "Connection name" defined in the "DB Explorer".
const connectionSetting = getConnectionSettingByName("localPostgres");

// https://github.com/l-v-yonsama/db-drivers/blob/main/doc/classes/DBDriverResolver.md#flowtransaction
const { ok, message, result } = await DBDriverResolver.getInstance().flowTransaction(
  connectionSetting,
  async (driver) => {
    // https://github.com/l-v-yonsama/db-drivers/blob/main/doc/classes/RDSBaseDriver.md#requestsql

    // for PostgreSQL
    const { rows } = await driver.requestSql({
      sql: "INSERT INTO order1 (customer_no, order_date, amount) VALUES (10, '2024-01-01', 300) RETURNING order_no AS inserted_no",
    });
    const orderNo = rows[0].values["inserted_no"];

    // for MySQL
    // const { summary } = await driver.requestSql({sql:"INSERT INTO testdb.order (customer_no, order_date, amount) VALUES (10, '2024-01-01', 300)"});
    // const orderNo = summary.insertId;

    for (let i = 1; i <= 3; i++) {
      // https://github.com/l-v-yonsama/db-drivers/blob/main/doc/modules.md#normalizequery
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
