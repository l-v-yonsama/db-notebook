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

## 7. Summary

- Variables are defined in **JSON cells**
- SQL cells reference them using `:variable_name`
- Supported patterns:
  - Exact match (`= :value`)
  - Partial match (`LIKE`)
  - List match (`IN (:list)`)
- Use `%` either in SQL or in variable values depending on portability needs
- `IN (:list)` improves readability and safety for multi-value conditions

This approach provides flexible and predictable SQL execution  
when using **Variable sharing between notebook cells**.
