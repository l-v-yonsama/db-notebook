# Changelog

All notable changes to the "Database notebook" extension are documented in this file.

## [Unreleased]

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
