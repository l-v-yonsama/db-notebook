# Database Notebook examples

This page shows an example of the use of the VS code extension "Database Notebook".

## TOC

- 1. [Query examples](#1-query-examples)
  - 1.1. [Bind parameters in query](#11-bind-parameters-in-query)
  - 1.2. [Variable sharing advanced examples (LIKE / IN)](./databaseNotebookVariableSharing.md)
- 2. [Controlling the Database with Javascript](#2-controlling-the-database-with-javascript)
  - 2.1. [Inserting parent and child records in the same transaction](#21-inserting-parent-and-child-records-in-the-same-transaction)

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
