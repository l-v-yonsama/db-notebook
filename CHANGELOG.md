# Changelog

All notable changes to the "Database notebook" extension are documented in this file.

## [Unreleased]

### Added

- TypeScript notebook cells. They run on the same Node.js kernel as JavaScript cells (the cell is transpiled via the TypeScript compiler before running), so they get the same shared variables, database driver access, and completion/hover/signature-help support. Syntax errors are caught before execution and reported without starting Node; type errors are not checked (transpile-only, no semantic type-checking).
- Shell/batch script notebook cells (`shellscript`: bash/sh/zsh, `bat`: Windows). Output is captured as plain stdout/stderr; status is determined by the process's real exit code (not by stderr presence, since many CLI tools write informational text to stderr on success). Configurable via new `shell.*` settings (`Shell path`, `Windows shell path`, `encoding`). `bat` (Windows `cmd.exe`) support is experimental -- its interpreter-selection logic is unit-tested, but end-to-end execution has not been verified on Windows.
- Redis command notebook cells (`redis`). Each cell is a single raw Redis command (e.g. `GET mykey`, `HGETALL myhash`) dispatched via ioredis's generic command call, so any Redis command works. Like SQL/Memcached cells, the reply comes back as a tabular (RDH) result instead of plain text -- a single `value` column for the general case, with `HGETALL` specially reshaped into a `field`/`value` table. Requires a Redis connection (`connectionName`). See [Database Notebook Redis/Memcached command cell examples](/docs/examples/databaseNotebookRedisAndMemcached.md).

## [1.2.0] - 2026-07-27

### Added

- Oracle Database support (Thin mode, via `oracledb` -- no Oracle Instant Client required), covering notebook SQL cells, the DB Explorer schema tree (including DDL export via `DBMS_METADATA.GET_DDL`), and the existing AI tools/MCP server. Scoped to DQL/DML; PL/SQL blocks and stored procedure/package calls are not supported.

### Changed

- Connection settings form's command buttons are now sticky to the bottom of the panel, so they stay reachable while scrolling a long form.

### Fixed

- `#createDbNotebook`/`#editDbNotebook` tool descriptions now state that each SQL cell must contain exactly one statement and must never include `BEGIN`/`COMMIT`/`ROLLBACK`, since every cell runs on its own independent, auto-committing connection. Previously the AI would sometimes pack multiple statements plus a trailing `COMMIT` into one cell, which fails when the cell runs.
- Tools view's "Kill session" button now recognizes Oracle's SID column, not just MySQL/SQL Server's `session_id` and Postgres's `pid`.
- Tools view now clears its previous contents even when the connection setting can't be found, instead of leaving stale data displayed.

## [1.1.0] - 2026-07-25

### Added

- Standalone MCP server, reachable from external MCP clients (Claude Code, Claude Desktop, Cursor, etc.), exposing the same connection/schema/query tools as the Copilot Chat Language Model Tools. Start/stop it and inspect its connection info/token from the new "MCP Server" view in the activity bar. See [MCP Server Usage Guide](/docs/examples/mcpServerUsageGuide.md).
- `mcpServer.autoStart` and `mcpServer.port` settings to control whether the MCP server starts automatically and which port it listens on.
- `runDbQuery`/the `#runDbQuery` tool can now run PartiQL statements against AWS connections configured for DynamoDB, in addition to SQL statements against SQL connections.

## [1.0.2] - 2026-07-23

### Added

- Documented the multi-language flow (SQL → JavaScript → Markdown) with variable sharing between cells, including passing a SQL cell's result set into a later JavaScript cell. See [Database Notebook file examples](/docs/examples/databaseNotebook.md#3-multi-language-flow-sql--javascript--markdown).

### Changed

- Expanded the README to describe mixing SQL, JavaScript, and Markdown cells in a single notebook file with shared variables.

### Fixed

- Default database type in the connection setting form now defaults to MySQL.

## [1.0.1] - 2026-07-21

### Added

- `#createDbNotebook` and `#editDbNotebook` AI tools for GitHub Copilot Chat (Agent mode), letting the AI create and edit `.dbn` notebook files directly.

### Changed

- Expanded `docs/examples/lmToolsUsageGuide.md` with the new notebook-authoring tools and an AI tools flow demo.

## [1.0.0] - 2026-07-19

### Added

- AI tools for GitHub Copilot Chat (Agent mode): `#listDbConnections`, `#testDbConnection`, `#getDbSchema`, `#runDbQuery`, `#runDbTransaction`, `#scanDbResource`.
- Per-connection "Allow AI tools" opt-in flag -- connections are invisible to AI tools until explicitly enabled.

## [0.12.1] - 2026-07-14

### Added

- SQL Server: AAD Access Token (Interactive) authentication support.

## [0.11.6] - 2026-07-10

### Changed

- Upgraded syntax highlighting to Prism.js.

## [0.11.4] - 2026-07-09

### Added

- Unit tests with Vitest and a CI workflow.

---

Earlier release notes were not tracked; see `git log` for the full history prior to 0.11.4.
