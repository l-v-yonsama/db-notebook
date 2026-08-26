# Performance Tuning Guide

Database Notebook helps you investigate slow or expensive statements by gathering the relevant
evidence in one place — the execution plan and related table metadata for MySQL, PostgreSQL, SQL
Server, and Oracle, or a static access-path classification and Capacity evidence for DynamoDB.
CloudWatch-backed DynamoDB monitoring evidence is also included when it is enabled for a real AWS
connection. Where supported, you can run the statement once to collect actual measurements.

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
  - 6.1. [Full Context JSON](#61-full-context-json)
- 7. [DynamoDB](#7-dynamodb)
  - 7.1. [How DynamoDB differs from SQL here](#71-how-dynamodb-differs-from-sql-here)
  - 7.2. [Start a preview](#72-start-a-preview)
  - 7.3. [Read the preview](#73-read-the-preview)
  - 7.4. [Run Observed Read](#74-run-observed-read)
  - 7.5. [Analyze with AI and save the analysis](#75-analyze-with-ai-and-save-the-analysis)
  - 7.6. [Constraints to keep in mind](#76-constraints-to-keep-in-mind)

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

The DBN starts with a linked table of contents and uses stable chapter numbers. For a quick review,
start with **4. Summary and recommendations**, then follow its evidence references into the later
chapters. If collection was partial, the first cell also directs you to **3. Collection status**
before relying on the summary.

The saved DBN includes:

- The SQL statement and performance snapshot.
- Collection issues and information.
- A SQL-scoped ER diagram and related indexes.
- Estimated and actual execution plans.
- The AI analysis result.
- Full context JSON, AI request messages, and AI analysis JSON.

Export the DBN as HTML to view the Mermaid ER diagram and formatted actual execution plan in a
browser.

### 6.1. Full Context JSON

The saved notebook's **Full context JSON** cell is the complete, machine-readable evidence snapshot
collected before the AI interprets it. It is useful when you want to verify an AI finding against
the source evidence, compare two tuning runs, or analyze the same context with another tool. It is
not the AI response; that is stored separately as **AI analysis JSON**.

Every context includes `formatVersion`, target statement information, and a `collection` block.
Check `collection.status` first: `complete` means all required sections were collected, while
`partial` means `diagnostics` or `unavailableSections` should be reviewed before drawing a
conclusion. An omitted optional field means that the value was not available; it must not be read as
zero.

For an RDB context, the main sections are:

- `database` and `statement` — the target database, SQL, statement type, and source.
- `workload` — execution counts, elapsed time, rows, and read statistics when the source provides
  them.
- `executionPlan` — the normalized plan, vendor-native plan artifacts, planning/execution time,
  runtime observations, and the dominant-cost node when available.
- `tables` — the definitions, indexes, statistics, and physical-health evidence for related tables.
- `planTableMappings` — links plan nodes to tables/indexes and records row-estimate, access-fraction,
  and filter-selectivity evidence.

For a DynamoDB context, `engine` is `dynamodb`, and the plan-oriented sections are replaced by:

- `service` and `statement` — the region/target and PartiQL or native Query information.
- `accessPattern` — the static `Query`/`Scan` classification, key conditions, post-read filters,
  projection, and consistency.
- `table` — Capacity mode, key schema, LSI/GSI definitions, TTL, and, when monitoring collection is
  enabled, Contributor Insights status.
- `workload` — the rolling timing, item-count, and Consumed Capacity summary from matching history,
  including (when the sample includes a native `Query`/`Scan`) the min/max/last filter pass rate
  across those samples.
- `observation` — the most recent observed or user-confirmed read; check `completeness` (`complete`,
  `bounded`, or `unknown`) before treating it as representative of the full result — only `complete`
  means so. `bounded` is kept alongside it for backward compatibility (`true` for both `bounded` and
  `unknown`).
- `cloudWatch` — table/index/operation-level time series when CloudWatch monitoring is collected. A
  series with `noData: true` is missing data, not measured zero activity.

The `cloudWatch` section and Contributor Insights status are intentionally omitted when CloudWatch
is not selected as a service for the connection, or when DynamoDB uses a local/custom endpoint such
as DynamoDB Local or LocalStack. In that case, `DYNAMODB_MONITORING_COLLECTION_SKIPPED` appears as
an information diagnostic. This expected skip does not by itself make `collection.status` partial
and does not indicate a missing IAM permission.

Where a metric uses `{ value, estimated, source, unit }`, use `source` and `estimated` to judge how
strong the evidence is. Also treat the JSON as potentially sensitive: RDB SQL/DDL and DynamoDB
PartiQL text can contain literals and are not automatically redacted. DynamoDB bind values,
`ExpressionAttributeValues`, returned items, and pagination keys are intentionally not stored.

The Full Context JSON remains complete in the notebook even if a large RDB vendor artifact had to
be omitted from a compact AI request. Use **AI request messages** to see the exact prompt and context
projection sent to the selected model.

## 7. DynamoDB

### 7.1. How DynamoDB differs from SQL here

DynamoDB has no query optimizer and no execution plan, so the preview shows a different kind of
evidence instead:

| SQL (sections 1-6 above) | DynamoDB |
| --- | --- |
| Estimated/actual execution plan | Static access-path classification (`Query` vs. `Scan`), decided from the statement's key condition against the table/index key schema |
| Estimated/actual row counts | `Count`/`ScannedCount` from a native `Query`/`Scan` observation (PartiQL has no `ScannedCount`) |
| Optimizer statistics | Capacity mode, key/index definitions, and recent CloudWatch time series when monitoring collection is enabled |
| Table maintenance signals (bloat, fragmentation, ...) | Consumed Capacity and, when monitoring collection is enabled, throttling reasons and Contributor Insights status |
| `Run Explain Analyze` | `Run Observed Read` — a single, user-confirmed request, capped at 100 evaluated items |

A PartiQL `SELECT` is guaranteed to run as a `Query` only when its `WHERE`/key condition includes
an equality (or `IN`) test on the target table's or index's partition key. Anything else is a full
`Scan` of that table or index. This is a deterministic fact about the statement as written, not a
measurement — it's shown even before any request is sent to DynamoDB.

### 7.2. Start a preview

Open the DynamoDB performance tuning preview from either of these places:

- **SQL History**, for a previously-run PartiQL statement, or a native `Query` executed from the
  Dynamo Query Panel — every Panel execution (success or failure) is saved to SQL History
  automatically, shown with item-based wording and no SQL syntax attached (its history entry has no
  equivalent of a runnable SQL cell). Repeating the exact same table/index/key-condition/filter/
  Projection/consistency structure with different values merges into one history entry rather than
  creating a new one each time.
- An **executed Notebook cell** running PartiQL against a DynamoDB connection (same entry point as
  SQL History — the cell's toolbar reuses its own most recent matching history entry).
Opening the preview from a SQL History entry (PartiQL or native `Query`) also carries over that
entry's most recent execution as observed evidence automatically — see **Observed request** in 7.3
and **Query flow** in 7.3 — without needing to run `Run Observed Read` again.

Unlike the SQL path, this never asks for bind values first: the preview never reads item data, so
no value is needed to open it. If the PartiQL text still has an unresolved `?` placeholder (for
example, a SQL History entry Database Notebook couldn't fully resolve from its recorded variables),
the preview still opens normally — only `Run Observed Read` (7.4) is disabled for that statement,
with the reason shown next to the button.

### 7.3. Read the preview

The layout mirrors the SQL preview's shape (3 above), with DynamoDB-specific sections in place of
the execution plan:

- **Performance snapshot** — access-path certainty, a rolling Capacity/timing trend from prior
  executions of this exact statement (when available), whether any read has been observed yet, and
  recent throttling activity. `Evidence: Observed read` appears once either `Run Observed Read` (7.4)
  or a matching SQL History execution supplies one.
- **Collection issues** and **Information** — the same two-tier diagnostics pattern as SQL,
  covering things like a permission failure on `DescribeTable`/`GetMetricData`, or that the
  context was shortened to fit the size limit.
- **Access pattern** — the resolved operation, partition/sort key condition, any post-read filter,
  projection, consistency, and (for a native `Query`) limit/scan direction.
- **Query flow** — a statement-specific Mermaid funnel showing the target and key access. When one
  read has been observed, its evaluated/returned item counts, filter pass rate, Consumed Capacity,
  client time, and bounded status are added to the flow. The table's approximate item count is
  labeled separately so it is not mistaken for a count from that one request.
- **Table and index definition** — key schema, Capacity mode, approximate item count/size, TTL
  status, and every LSI/GSI's own key schema and projection.
- **Observed request** — empty until a read has actually been observed (7.4), or carries over
  evidence from a matching SQL History execution. A history-sourced observation whose result was cut
  short (a continuation key remained, or an older saved entry doesn't record that status at all) is
  never presented as the statement's complete result.
- **CloudWatch window metrics** — when monitoring collection is enabled, the last hour's Consumed
  Capacity/throttle time series for the table/index/operation. This is *table-wide*, not scoped to
  this one statement — see 7.6.

CloudWatch metrics and Contributor Insights status are collected only when **CloudWatch is selected
as a service for the connection and the connection uses the real AWS endpoint**. If CloudWatch is
not selected, or the connection uses DynamoDB Local, LocalStack, or another custom endpoint, those
requests are not sent. The preview reports **CloudWatch monitoring not collected** under
**Information**; it does not add a **Collection issues** warning, make the collection `partial`, or
suggest an IAM permission change solely because of this expected skip. On a real AWS connection
with CloudWatch selected, an actual collection failure continues to appear under **Collection
issues** with the relevant action and technical details.

### 7.4. Run Observed Read

`Run Observed Read` sends the statement once for real — the first response only, capped at 100
evaluated items — to measure its actual Consumed Capacity, returned/evaluated item counts, and (for a
native `Query`) filter pass rate. A response can return zero matching items and still include a
continuation marker when unevaluated items may remain; later pages are not fetched and are not
guaranteed to contain a match. Running the observation again starts over from the beginning rather
than continuing from that marker. Like `Run Explain Analyze`, this is real I/O against the database,
so read the confirmation dialog before continuing.

The button is disabled, with a reason shown next to it, whenever the statement isn't eligible: a
PartiQL statement with an unresolved `?` placeholder (7.2), or when this connection's IAM policy
hasn't been verified to allow it yet — an `AccessDenied` only ever surfaces after you confirm the
run, never as a pre-flight guess.

### 7.5. Analyze with AI and save the analysis

`Analyze with AI` and `Copy Prompt for Other AI` work the same way as for SQL (5 above), with a
DynamoDB-specific prompt: it distinguishes the static access-path classification from a one-off
observed read from CloudWatch's table-wide ambient activity, and never suggests a `CREATE INDEX`
statement (DynamoDB has none) or treats a narrower projection as a Read Capacity saving.
When monitoring was intentionally skipped because of the connection configuration or endpoint, the
AI treats that as the expected analysis scope rather than a collection failure or IAM problem.

`Save as Notebook` (6 above) also works the same way, with a DynamoDB-shaped report: overview and
target statement, a statement-specific query-flow diagram, performance snapshot, collection issues,
access pattern, table/index definition, observed request, available CloudWatch metrics, the AI
analysis, an appendix of the collected CloudWatch datapoints, and the full context/AI request/AI
analysis JSON. When monitoring collection is outside the connection's configured scope, the
CloudWatch section and raw-metrics appendix remain in the notebook and state that metrics or
datapoints were not collected.

### 7.6. Constraints to keep in mind

These hold regardless of what the AI analysis suggests:

- A narrower `Projection` (fewer returned attributes) never reduces Read Capacity — DynamoDB
  charges for the size of the items it reads, not what's returned afterward.
- A post-read filter doesn't add Capacity on top of a read — the items it filters out were already
  read and charged before the filter ran.
- When collected, CloudWatch metrics are table/index/operation-scoped, aggregated over the whole
  collection window — never evidence about this one statement alone.
- `Table and index definition`'s item count and table size are AWS-reported approximations, updated
  roughly every six hours — never treat them as an exact count.
- A hot partition is never assumed from general throttling alone — only from a key-range-specific
  throttle signal or Contributor Insights evidence.
- Contributor Insights' own key report is never fetched (only its enabled/disabled status) — the
  underlying key values can be sensitive, and a PartiQL request isn't covered by Contributor
  Insights in the first place.
- A Local Secondary Index can only be defined when its table is created — it can't be added later,
  unlike a Global Secondary Index.
- Querying a Local Secondary Index for an attribute outside its own projection may fetch that
  attribute from the base table, adding latency/Capacity beyond the index Query alone; a Global
  Secondary Index can never do this — it simply can't return a non-projected attribute at all, and
  can't use a strongly consistent read either.
- A `workload` aggregate built from SQL History is the sample of this exact statement's executions
  that happen to be saved locally — not a random or complete sample of every partition/key value the
  statement has ever run against; a wide spread between its minimum and maximum filter pass rate
  points at that skew, not at a single "typical" rate.
