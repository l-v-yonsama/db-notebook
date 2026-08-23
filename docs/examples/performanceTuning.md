# Performance Tuning Guide

Database Notebook helps you investigate slow SQL statements by gathering the execution plan and
related table metadata in one place. Where supported, you can also run the statement to collect an
actual execution plan and measurements.

## TOC

- 1. [Overview](#1-overview)
- 2. [Start a performance tuning preview](#2-start-a-performance-tuning-preview)
- 3. [Read the preview](#3-read-the-preview)
  - 3.1. [Performance snapshot](#31-performance-snapshot)
  - 3.2. [Collection issues and information](#32-collection-issues-and-information)
  - 3.3. [Execution plan](#33-execution-plan)
- 4. [Run Explain Analyze](#4-run-explain-analyze)
- 5. [Analyze with AI](#5-analyze-with-ai)
- 6. [Save and share the analysis](#6-save-and-share-the-analysis)

## 1. Overview

Use the preview to inspect the evidence needed to diagnose a slow statement:

- Compare estimated and actual row counts when actual measurements are available.
- Review indexes, optimizer statistics, and physical-maintenance signals.
- Give Copilot or another AI the collected evidence to request improvement ideas.
- Save the analysis as a Database Notebook (DBN) or export it as an HTML report.

## 2. Start a performance tuning preview

Open the performance tuning preview for the target statement from **SQL History** or **Query
Statistics**.

If the SQL contains placeholders, provide representative bind values. These values are used only to
retrieve the plan; they are not written to the saved connection settings.

The preview first collects an estimated plan and related metadata. `Status: complete` means the
required collection has finished. If the status is `partial`, review **Collection issues** to see
which information could not be collected and how that affects the analysis.

## 3. Read the preview

### 3.1. Performance snapshot

The performance snapshot is a deterministic summary created from the collected data; it is separate
from any AI analysis.

- `Evidence: Estimate only` means that only the estimated plan is available.
- `Evidence: Actual measured` means actual measurements are available.
- `Observed signals` highlights clues about estimate accuracy and table maintenance.
- `Table row flow` shows the rows in the full table, the rows accessed, the rows that pass filters,
  and the rows output by the plan.

`Access fraction` is the proportion of the full table that the plan accesses. `Filter pass rate` is
the proportion of those accessed rows that pass the filter. They measure different things.

### 3.2. Collection issues and information

**Collection issues** reports information that can affect the accuracy of the analysis, such as
insufficient permissions or collection limits. Review the suggested action and technical details
when needed.

**Information** identifies plan characteristics such as filesorts or temporary tables. A
characteristic by itself does not prove that there is a problem.

### 3.3. Execution plan

When actual measurements are available, the preview prioritizes actual evidence.

- PostgreSQL includes actual timing and row counts in its normalized execution plan.
- MySQL, Oracle, and SQL Server may display a separate, vendor-specific actual execution plan.
- `Table metrics` compares estimated and actual row counts, ratios, and filter metrics.

## 4. Run Explain Analyze

`Run Explain Analyze` executes the target SQL on the database to obtain an actual plan. Even a
read-only statement can create load or wait for locks, so read the confirmation dialog before
continuing.

- Only a single `SELECT` statement is eligible.
- `INSERT`, `UPDATE`, and `DELETE` statements use an estimated plan only.
- On success, the warning disappears and `Evidence: Actual measured`, actual plans, and measured
  metrics are displayed.

Before running this in production, confirm the statement's expected load and your operational
rules.

## 5. Analyze with AI

1. Run `Run Explain Analyze` first if actual measurements are needed and it is safe to do so.
2. Select a language model.
3. Enable `Translate response` if you want the response in another language.
4. Select `Analyze with AI`.

The AI response includes a summary, findings, recommendations, and missing context. Suggested SQL
is never run automatically. Validate DDL and rewritten SQL in a test environment, review their
execution plans, and assess their impact before applying them.

To use an AI other than Copilot, select `Copy Prompt for Other AI` and paste the prompt into a
client such as ChatGPT, Claude, or Codex. When `Translate response` is enabled, the copied prompt
also specifies the response language.

## 6. Save and share the analysis

After an AI analysis succeeds, select `Save as Notebook` to create a DBN under
`reports/performance-tuning/` in the workspace.

The saved DBN includes:

- The SQL statement and performance snapshot.
- Collection issues and information.
- A SQL-scoped ER diagram and related indexes.
- Estimated and actual execution plans.
- The AI analysis result.
- Full context JSON, AI request messages, and AI analysis JSON.

Export the DBN as HTML to view the Mermaid ER diagram and formatted actual execution plan in a
browser.
