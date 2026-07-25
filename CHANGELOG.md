# Changelog

All notable changes to the "Database notebook" extension are documented in this file.

## [Unreleased]

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
