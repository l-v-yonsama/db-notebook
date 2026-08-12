# Database Notebook Variable sharing between notebook cells – SQL examples

This page explains how to use **shared variables** defined in JSON cells  
as **bind parameters** in SQL cells.

Bind variables are referenced using **Colon + variable name**.

```sql
:variable_name
```

---

## 1. Define shared variables in a JSON cell

Shared variables are defined in a JSON cell and can be reused across SQL cells.

```json
{
  "ename": "TARO",
  "keyword": "TA",
  "ename_list": ["TARO", "HANAKO", "KING"]
}
```

- `ename` is used for **exact match**
- `keyword` is used for **partial match (LIKE search)**
- `ename_list` is used for **IN (:list) search**

---

## 2. Base data

The following examples assume the `EMP` table contains these values:

```sql
SELECT ENAME FROM EMP;
```

Result:

| ENAME |
| :--- |
| HANAKO |
| TARO |
| POCHI |
| SCOTT |
| KING |
| TANUKICHI |

---

## 3. Exact match search (完全一致検索)

```sql
SELECT ENAME
FROM EMP
WHERE ENAME = :ename;
```

Result:

| ENAME |
| :--- |
| TARO |

---

## 4. Partial match search (部分一致検索 / LIKE)

### Pattern A: Add wildcards in SQL (DB-dependent)

```sql
-- MySQL
WHERE ENAME LIKE CONCAT('%', :keyword, '%');

-- PostgreSQL / SQL Server / SQLite
WHERE ENAME LIKE '%' || :keyword || '%';
```

### Pattern B: Include wildcards in variable value (DB-independent)

```json
{
  "keyword": "%TA%"
}
```

```sql
WHERE ENAME LIKE :keyword;
```

---

## 5. IN (:list) search pattern

You can also use **array variables** with the `IN` clause.

### Define list variable in JSON cell

```json
{
  "ename_list": ["TARO", "HANAKO", "KING"]
}
```

### SQL cell

```sql
SELECT ENAME
FROM EMP
WHERE ENAME IN ( :ename_list );
```

### Result example

| ENAME |
| :--- |
| HANAKO |
| TARO |
| KING |

---

## 6. Notes and best practices for IN (:list)

- The variable value must be an **array**
- Each element is bound safely as a parameter
- Empty lists may result in invalid SQL (`IN ()`)
  - Ensure the list is non-empty before executing
- This pattern works consistently across  
  **MySQL, PostgreSQL, SQL Server, and SQLite**

---

## 7. Use shared variables in shellscript / bat cells

Shared variables defined in a preceding cell (JSON, JavaScript, TypeScript, SQL, ...)
are also exposed as **environment variables** to `shellscript` and `bat` cells, named:

```text
DB_NOTEBOOK_VAR_<variable name>
```

```json
{
  "environment": "staging",
  "retryCount": 3,
  "dryRun": true,
  "ids": [10, 20, 30],
  "options": {
    "output": "result.csv"
  }
}
```

```bash
echo "$DB_NOTEBOOK_VAR_environment"
echo "$DB_NOTEBOOK_VAR_retryCount"

if [ "$DB_NOTEBOOK_VAR_dryRun" = "true" ]; then
  echo "Dry-run mode"
fi

# Arrays and objects are passed as JSON strings; parse them with jq if needed.
printf '%s\n' "$DB_NOTEBOOK_VAR_ids" | jq -r '.[]'
```

On a `bat` cell (Windows), reference the same values with `%NAME%` syntax:

```bat
echo %DB_NOTEBOOK_VAR_environment%
```

### Value conversion rules

| Variable type | Environment variable content | Example |
| --- | --- | --- |
| string | as-is | `staging` |
| number | `String(value)` | `3` |
| boolean | `String(value)` | `true` |
| `null` | the string `"null"` | `null` |
| array | `JSON.stringify(value)` | `[10,20,30]` |
| object | `JSON.stringify(value)` | `{"output":"result.csv"}` |

Strings, numbers, and booleans are exposed as plain, unquoted text, so beginners
can use them directly (`if [ "$DB_NOTEBOOK_VAR_dryRun" = "true" ]; then ...`)
without needing to parse JSON. Arrays and objects are exposed as JSON strings,
so only scripts that actually need them have to parse them (e.g. with `jq`).

### Limitations

- The variable name must match `^[A-Za-z_][A-Za-z0-9_]*$` (letters, digits,
  underscore; cannot start with a digit). A name that doesn't match this
  pattern makes the cell fail with an error naming the offending variable —
  invalid names are **not** silently renamed, since e.g. `user-name` and
  `user_name` could otherwise collide.
- Values that cannot be represented this way — `undefined`, functions,
  symbols, strings containing a NUL character, or objects/arrays that
  `JSON.stringify()` cannot serialize (e.g. circular references) — also make
  the cell fail with an error naming the offending variable. The value itself
  is never included in the error message or logs.
- Variable names starting with `_` (internal bookkeeping such as `_skipSql`)
  are not exposed to the shell.
- This is **one-way**: a shellscript/bat cell cannot write values back into
  the notebook's shared variables (no `export`, `VAR=value`, `cd`, function,
  alias, or shell option is carried over to later cells either).
- The shared variables available to a cell follow the existing sharing scope:
  cells executed together (e.g. "Run All") or pre-execution cells configured
  for the target cell. Running an unrelated cell earlier and then running this
  cell alone in a separate request does not carry variables over.
- Very large values (e.g. a big SQL result set saved into a shared variable)
  can hit OS-level environment variable size limits; if the shell process
  fails to start for that reason, the error message calls this out.

---

## 8. Summary

- Variables are defined in **JSON cells**
- SQL cells reference them using `:variable_name`
- Supported patterns:
  - Exact match (`= :value`)
  - Partial match (`LIKE`)
  - List match (`IN (:list)`)
- Use `%` either in SQL or in variable values depending on portability needs
- `IN (:list)` improves readability and safety for multi-value conditions
- `shellscript`/`bat` cells can read the same shared variables as
  `DB_NOTEBOOK_VAR_<name>` environment variables (see section 7)

This approach provides flexible and predictable SQL execution  
when using **Variable sharing between notebook cells**.
