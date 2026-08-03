# Database Notebook Redis/Memcached command cell examples

This page shows an example of Redis/Memcached command cell usage using the VS Code Extension "Database Notebook".

Unlike shell cells, a `redis` or `memcached` cell doesn't print plain stdout text -- its reply comes back as a tabular (RDH) result, the same way a SQL cell's result set does, so it can be sorted/filtered/exported like any other query result.

## TOC

- [Setup](#setup)
- 1. [Redis command cell](#1-redis-command-cell)
  - 1.1. [SET / GET (single value)](#11-set--get-single-value)
  - 1.2. [HGETALL (field/value table)](#12-hgetall-fieldvalue-table)
  - 1.3. [LRANGE (multiple rows)](#13-lrange-multiple-rows)
- 2. [Memcached command cell](#2-memcached-command-cell)
  - 2.1. [get (single row)](#21-get-single-row)
  - 2.2. [cachedump (multiple rows)](#22-cachedump-multiple-rows)

## Setup

### Create Connection Setting

Redis:

- Database type: Redis
- Connection name: localRedis
- Host: 127.0.0.1
- Port: 6379

Memcached:

- Database type: Memcache
- Connection name: localMemcache
- Host: 127.0.0.1:11211

Create a code cell and set its language to `redis` or `memcached`, then open **Show metadata settings** and set **Connection name** to one of the connections above. Both cell languages require a connection, the same way SQL cells do.

## 1. Redis command cell

A `redis` cell's raw text is sent as-is to Redis via ioredis's generic command dispatch (`client.call(commandName, ...args)`), so any Redis command works, not just the ones below. Wrap an argument in double or single quotes if it contains spaces (e.g. `SET greeting "Hello, Redis!"`); the quotes are stripped before sending, everything else splits on whitespace.

The reply is converted into a table:

- **General case**: a single `value` column (always typed JSON, so it can safely render a string, number, status reply, array, or nil the same way). An array reply becomes one row per element; an object/array element is JSON-stringified, anything else is shown as-is.
- **`HGETALL`**: the one named exception. Its flat `[field1, value1, field2, value2, ...]` reply is reshaped into a two-column `field`/`value` table instead, since that's far more readable than the generic case would make it.

### 1.1. SET / GET (single value)

#### Define cells.

Cell[1]

```redis
SET greeting "Hello, Redis!"
```

Cell[2]

```redis
GET greeting
```

#### Execution Result.

Cell[1] (SET)

`[Command Result]` 1 row in set (0.00 sec)

| value |
| :--- |
| JSON |
| OK |

Cell[2] (GET)

`[Command Result]` 1 row in set (0.00 sec)

| value |
| :--- |
| JSON |
| Hello, Redis! |

> A key that doesn't exist still returns a normal result -- one row with `value` = `` `NULL` `` (e.g. `GET does-not-exist`) -- rather than an error, since Redis's nil reply isn't a failure.

### 1.2. HGETALL (field/value table)

#### Define cells.

Cell[1]

```redis
HSET user-hash name Bob age 20 description "I am a programmer"
```

Cell[2]

```redis
HGETALL user-hash
```

#### Execution Result.

Cell[1] (HSET) -- the generic case: HSET's reply is the number of new fields added.

`[Command Result]` 1 row in set (0.00 sec)

| value |
| :--- |
| JSON |
| 3 |

Cell[2] (HGETALL) -- the named special case.

`[Command Result]` 3 rows in set (0.00 sec)

| field | value |
| :--- | :--- |
| TEXT | TEXT |
| name | Bob |
| age | 20 |
| description | I am a programmer |

### 1.3. LRANGE (multiple rows)

#### Define cells.

Cell[1]

```redis
RPUSH list3 1 2 3
```

Cell[2]

```redis
LRANGE list3 0 -1
```

#### Execution Result.

Cell[1] (RPUSH) -- reply is the list's new length.

`[Command Result]` 1 row in set (0.00 sec)

| value |
| :--- |
| JSON |
| 3 |

Cell[2] (LRANGE) -- an array reply, so one row per element.

`[Command Result]` 3 rows in set (0.00 sec)

| value |
| :--- |
| JSON |
| 1 |
| 2 |
| 3 |

## 2. Memcached command cell

A `memcached` cell is read-only inspection, not a general command dispatcher like `redis` cells: only two commands are recognized, `get <key>` (exact match) and `cachedump <limit> <keyword>` (partial key match, up to `limit` results). There's no `set`/`delete` here -- the examples below assume the keys already exist (written by your application, or another tool) and the cell is just reading them back.

Every reply -- regardless of command -- comes back as the same 5-column shape: `key`, `raw_text`, `raw_buffer`, `type`, `formatted`. `type` is auto-detected per value (`TEXT`/`NUMERIC`/`BOOLEAN`/`TIMESTAMP`/`JSON`/`BLOB`); `formatted` holds a JSON-pretty-printed string for JSON-shaped values and a hex dump in `raw_text`/`raw_buffer` for binary ones. The examples below stick to plain TEXT/NUMERIC values to keep the tables readable.

### 2.1. get (single row)

Assumes key `session:42` already holds the string `active`.

#### Define cells.

```memcached
get session:42
```

#### Execution Result.

`[Command Result]` 1 row in set (0.00 sec)

| key | raw_text | raw_buffer | type | formatted |
| :--- | :--- | :--- | :--- | :--- |
| TEXT | TEXT | BLOB | ENUM | TEXT |
| session:42 | active | `NULL` | TEXT | active |

### 2.2. cachedump (multiple rows)

Assumes keys `user:1001` (`active`) and `user:1001:visits` (`7`) already exist.

#### Define cells.

```memcached
cachedump 10 user
```

#### Execution Result.

`[Command Result]` 2 rows in set (0.01 sec)

| key | raw_text | raw_buffer | type | formatted |
| :--- | :--- | :--- | :--- | :--- |
| TEXT | TEXT | BLOB | ENUM | TEXT |
| user:1001 | active | `NULL` | TEXT | active |
| user:1001:visits | 7 | `NULL` | NUMERIC | 7 |
