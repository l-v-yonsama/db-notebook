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
  - 4.1. [Run a relational benchmark](#41-run-a-relational-benchmark)
- 5. [Analyze with AI](#5-analyze-with-ai)
- 6. [Save and share the analysis](#6-save-and-share-the-analysis)
  - 6.1. [Full Context JSON](#61-full-context-json)
- 7. [Compare against a baseline](#7-compare-against-a-baseline)
  - 7.1. [Select a baseline](#71-select-a-baseline)
  - 7.2. [Read the comparison](#72-read-the-comparison)
  - 7.3. [When a comparison is refused or qualified](#73-when-a-comparison-is-refused-or-qualified)
  - 7.4. [Comparison and AI analysis](#74-comparison-and-ai-analysis)
  - 7.5. [Save a comparison report](#75-save-a-comparison-report)
- 8. [DynamoDB](#8-dynamodb)
  - 8.1. [How DynamoDB differs from SQL here](#81-how-dynamodb-differs-from-sql-here)
  - 8.2. [Start a preview](#82-start-a-preview)
  - 8.3. [Read the preview](#83-read-the-preview)
  - 8.4. [Run Observed Read](#84-run-observed-read)
  - 8.5. [Run a DynamoDB benchmark](#85-run-a-dynamodb-benchmark)
  - 8.6. [Analyze with AI and save the analysis](#86-analyze-with-ai-and-save-the-analysis)
  - 8.7. [Constraints to keep in mind](#87-constraints-to-keep-in-mind)

## 1. Overview

Use the preview to inspect the evidence needed to diagnose a slow statement:

- Compare estimated and actual row counts when actual measurements are available.
- Measure three or five ordinary executions and compare their distributions against a baseline.
- Review indexes, optimizer statistics, and physical-maintenance signals.
- Give Copilot or another AI the collected evidence to request improvement ideas.
- Save the analysis as a Database Notebook (DBN) or export it as an HTML report.

## 2. Start a performance tuning preview

Open the performance tuning preview for the target statement from **Query History** or **Query
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

### 4.1. Run a relational benchmark

Open **Benchmark options** and choose `Benchmark (3 runs)` or `Benchmark (5 runs)`. After
confirmation, Database Notebook collects one `EXPLAIN ANALYZE`, then runs the same `SELECT`
normally three or five times.

The instrumented `EXPLAIN ANALYZE` is plan evidence and is not included in the benchmark
distribution. The Benchmark section shows every ordinary run plus median, average, minimum, and
maximum client elapsed time. There is no hidden warm-up run, so cache state and concurrent load can
still affect the result. Use the same run count and representative bind values on both sides of a
baseline comparison.

## 5. Analyze with AI

1. Run `Run Explain Analyze` first if actual measurements are needed and it is safe to do so.
2. Select a language model.
3. Enable `Translate response` if you want the response in another language.
4. Select `Analyze with AI`.

The AI response includes a summary, findings, recommendations, and missing context. A suggested
query is never run automatically. Validate DDL and rewritten statements in a test environment,
review their execution plans, and assess their impact before applying them.

To use an AI other than Copilot, select `Copy Prompt for Other AI` and paste the prompt into a
client such as ChatGPT, Claude, or Codex. When `Translate response` is enabled, the copied prompt
also specifies the response language.

## 6. Save and share the analysis

Select `Save as Notebook` to create a DBN under `reports/performance-tuning/` in the workspace. The
collected evidence can be saved before running AI; an available AI analysis, benchmark, and baseline
comparison are included when present.

The DBN starts with a linked table of contents and uses stable chapter numbers. For a quick review,
start with **4. Summary and recommendations**, then follow its evidence references into the later
chapters. If collection was partial, the first cell also directs you to **3. Collection status**
before relying on the summary.

The saved DBN includes:

- The SQL statement and performance snapshot.
- Collection issues and information.
- A SQL-scoped ER diagram and related indexes.
- Estimated and actual execution plans.
- Benchmark samples and aggregate timing, when collected.
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
- `benchmark` — the requested three- or five-run session and each ordinary measured sample, when
  one has been run.

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
- `benchmark` — Page or Complete-result samples, aggregate timing/Capacity values, and completion
  status, when one has been run.
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

## 7. Compare against a baseline

Once you have saved a report for a statement, you can reopen the preview after making a change and
compare the two side by side. The comparison is computed by the extension from the two collected
contexts, so every figure in it is available before — and without — any AI analysis.

This works for both engines: RDB reports compare against RDB reports, and DynamoDB against DynamoDB.

### 7.1. Select a baseline

In the **Comparison with baseline** section of the preview, select `Compare with Baseline…` and pick
a saved `.dbn`. The dialog opens in `reports/performance-tuning/` and remembers the last folder you
picked for the rest of the session.

The baseline file is read once, read-only, and never written back. The context it contains is kept
as a snapshot, so a comparison already on screen — or already saved into a report — stays
reproducible even if that file is later moved, edited, or deleted.

Use `Change Baseline…` to pick a different report and `Clear Baseline` to stop comparing.

If the selected file is not a saved performance tuning report, the comparison is refused with a
reason, and the baseline you already had stays selected.

### 7.2. Read the comparison

- **Comparability** states whether the two sides can be compared at all, followed by the specific
  notes behind that verdict.
- **Key changes** lists the largest comparable movements, best first.
- **Request changes** shows the two statements and a line diff. For a native DynamoDB Query, which
  has no statement text, the request structure is diffed instead.
- **Access path changes** shows how each table is reached (RDB) or how the read is routed
  (DynamoDB), plus the engine properties that differ.
- **Index changes** lists index definitions seen on one side and not the other, kept separate from
  which indexes the statement actually used.
- **Metric comparison** is the full table: metric, baseline, current, change, assessment.
- **Advanced details: Comparison Evidence JSON** is the complete, unrounded computation, including
  the baseline's file name, path at selection time, and the SHA-256 of its context.

Improvement, regression, no change, and "not comparable" are always labelled with both an icon and
text, never color alone.

### 7.3. When a comparison is refused or qualified

Two reports collected at different times are not a controlled experiment, so the comparison states
what it can and cannot support:

- **Not comparable** — the two sides target different engines, vendors, databases, or tables, or
  their statement kinds differ. No improvement percentage is shown at all: every metric is reported
  as not comparable, and only the raw values from each side remain.
- **Partially comparable** — something changed that qualifies the numbers: the statement itself, the
  set of tables read, an estimate-only side paired with a measured one, a partial collection, a
  large gap in optimizer-statistics freshness, a different environment, or (DynamoDB) an observation
  that was bounded on only one side, two observations cut off at different points, or a differently
  shaped CloudWatch window. Benchmark metrics are also qualified when the run count, mode, or
  completion status differs.

When the two sides came from different environments — a different `environment` label on a
relational connection, or DynamoDB Local/LocalStack against real AWS — timings and host I/O counters
are reported as not comparable, because they measure the machine as much as the statement. Row
counts, item counts, and consumed capacity still compare.

A table that the plan reaches through more than one step (a self join, for example) has no
one-to-one correspondence between the two collections, so its per-table metrics are reported as not
comparable rather than pairing an arbitrary step from each side.
- **Comparable, with notes** — data volume, cache state, and concurrent load still differ between
  two collection times; CloudWatch still aggregates other traffic; DynamoDB item counts and table
  sizes are still approximate.

Individual metrics carry their own verdict too. A metric the extension declines to compare still
shows both raw values, but never a rate of change and never an improvement figure. Percentage points
are used where subtracting two rates is the honest figure, instead of a percent change of a percent.

An index seen on one side and not the other is reported as an observation, not as a record of
someone creating or dropping it.

### 7.4. Comparison and AI analysis

When a baseline is selected, `Analyze with AI` and `Copy Prompt for Other AI` both include a
comparison input alongside the current context. The baseline's full context is never sent: the input
carries the two statements, the structural differences, the already-computed numbers, and the
per-metric comparability decisions.

The model is instructed not to recompute those figures, not to derive an improvement from a metric
marked not comparable, and not to treat a snapshot difference as a proven cause. Any AI analysis text
inside the baseline report is deliberately not sent.

If the request does not fit the selected model's input window, it is reduced in a fixed order — the
current context first, then the request diff (both statements are always kept), then the collection
differences. What was left out is recorded in the saved analysis rather than dropped silently. If it
still does not fit, the analysis is not started and the required and available token counts are
reported.

Changing or clearing the baseline marks an AI result already on screen as stale, with a prompt to run
the analysis again, rather than presenting it as commentary on the new comparison. This includes
changing the baseline while an analysis is still running: the result is recorded against the baseline
it was actually sent with, not whichever one happens to be selected when the response arrives.

### 7.5. Save a comparison report

`Save as Notebook` is available as soon as a baseline is selected, whether or not you have run an AI
analysis. If the analysis on screen is marked stale, it is left out of the saved report and a
comparison-only report is written instead — mixing an analysis of one baseline with a comparison
against another would misrepresent both. Run `Analyze with AI` again to include it.

A comparison report adds:

- **Comparison with baseline** — summary, key changes, request changes, access path changes, index
  and schema changes, the metric table, comparability notes, and the baseline source.
- **Comparison Evidence JSON** — every figure above, unrounded.
- **Baseline Full context JSON** and **Current Full context JSON** — the two contexts the comparison
  was computed from.

Because both contexts are stored in the report itself, it stays readable after the original baseline
file is gone. The existing **Full context JSON** cell is still written unchanged, so tools built
against earlier reports keep working; selecting a comparison report as a baseline later resolves the
**Current** context, not the older baseline it was compared against.

Comparison contexts use `formatVersion: 1`, and a report whose context declares any other version is
refused rather than read optimistically, so a future format change cannot be silently misread by this
version of the extension.

## 8. DynamoDB

### 8.1. How DynamoDB differs from SQL here

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

### 8.2. Start a preview

Open the DynamoDB performance tuning preview from either of these places:

- **Query History**, for a previously-run PartiQL statement, or a native `Query` executed from the
  Dynamo Query Panel — every Panel execution (success or failure) is saved to Query History
  automatically, shown with item-based wording and no SQL syntax attached (its history entry has no
  equivalent of a runnable SQL cell). Repeating the exact same table/index/key-condition/filter/
  Projection/consistency structure with different values merges into one history entry rather than
  creating a new one each time.
- An **executed Notebook cell** running PartiQL against a DynamoDB connection (same entry point as
  Query History — the cell's toolbar reuses its own most recent matching history entry).
Opening the preview from a Query History entry (PartiQL or native `Query`) also carries over that
entry's most recent execution as observed evidence automatically — see **Observed request** and
**Query flow** in 8.3 — without needing to run `Run Observed Read` again.

Unlike the SQL path, this never asks for bind values first: the preview never reads item data, so
no value is needed to open it. If the PartiQL text still has an unresolved `?` placeholder (for
example, a Query History entry Database Notebook couldn't fully resolve from its recorded variables),
the preview still opens normally — only `Run Observed Read` (8.4) and Benchmark are disabled for
that statement, with the reason shown next to the button.

### 8.3. Read the preview

The layout mirrors the SQL preview's shape (3 above), with DynamoDB-specific sections in place of
the execution plan:

- **Performance snapshot** — access-path certainty, a rolling Capacity/timing trend from prior
  executions of this exact statement (when available), whether any read has been observed yet, and
  recent throttling activity. `Evidence: Observed read` appears once either `Run Observed Read` (8.4)
  or a matching Query History execution supplies one.
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
- **Observed request** — empty until a read has actually been observed (8.4), or carries over
  evidence from a matching Query History execution. A history-sourced observation whose result was cut
  short (a continuation key remained, or an older saved entry doesn't record that status at all) is
  never presented as the statement's complete result.
- **CloudWatch window metrics** — when monitoring collection is enabled, the last hour's Consumed
  Capacity/throttle time series for the table/index/operation. This is *table-wide*, not scoped to
  this one statement — see 8.7.

CloudWatch metrics and Contributor Insights status are collected only when **CloudWatch is selected
as a service for the connection and the connection uses the real AWS endpoint**. If CloudWatch is
not selected, or the connection uses DynamoDB Local, LocalStack, or another custom endpoint, those
requests are not sent. The preview reports **CloudWatch monitoring not collected** under
**Information**; it does not add a **Collection issues** warning, make the collection `partial`, or
suggest an IAM permission change solely because of this expected skip. On a real AWS connection
with CloudWatch selected, an actual collection failure continues to appear under **Collection
issues** with the relevant action and technical details.

### 8.4. Run Observed Read

`Run Observed Read` sends the statement once for real — the first response only, capped at 100
evaluated items — to measure its actual Consumed Capacity, returned/evaluated item counts, and (for a
native `Query`) filter pass rate. A response can return zero matching items and still include a
continuation marker when unevaluated items may remain; later pages are not fetched and are not
guaranteed to contain a match. Running the observation again starts over from the beginning rather
than continuing from that marker. Like `Run Explain Analyze`, this is real I/O against the database,
so read the confirmation dialog before continuing.

The button is disabled, with a reason shown next to it, when the statement isn't eligible, such as a
PartiQL statement with an unresolved `?` placeholder (8.2). IAM permission is not guessed in
advance; an `AccessDenied` surfaces only after you confirm the run.

### 8.5. Run a DynamoDB benchmark

Open **Benchmark options** and choose one of these confirmed measurement modes:

- `Page Benchmark (3/5 runs)` measures one response per run, capped at 100 evaluated items. It is
  intentionally bounded and is useful for comparing the cost of the same bounded access pattern.
- `Complete-result Benchmark (3/5 runs)` follows continuation tokens, but each run stops at 10
  pages, 1,000 evaluated items, or 30 seconds. If a limit is reached, the result is labelled
  **INCOMPLETE** and must not be treated as the full result.

The Benchmark section shows each run's client elapsed time, returned/evaluated counts, consumed read
capacity, and aggregate median/average/min/max timing. There is no hidden warm-up run. Compare only
sessions with the same mode, run count, and completion status.

### 8.6. Analyze with AI and save the analysis

`Analyze with AI` and `Copy Prompt for Other AI` work the same way as for SQL (5 above), with a
DynamoDB-specific prompt: it distinguishes the static access-path classification from a one-off
observed read from CloudWatch's table-wide ambient activity, and never suggests a `CREATE INDEX`
statement (DynamoDB has none) or treats a narrower projection as a Read Capacity saving.
When monitoring was intentionally skipped because of the connection configuration or endpoint, the
AI treats that as the expected analysis scope rather than a collection failure or IAM problem.

`Save as Notebook` (6 above) also works the same way, with a DynamoDB-shaped report: overview and
target statement, a statement-specific query-flow diagram, performance snapshot, collection issues,
access pattern, table/index definition, observed request, Benchmark, available CloudWatch metrics,
the AI analysis, an appendix of the collected CloudWatch datapoints, and the full context/AI
request/AI analysis JSON. When monitoring collection is outside the connection's configured scope, the
CloudWatch section and raw-metrics appendix remain in the notebook and state that metrics or
datapoints were not collected.

### 8.7. Constraints to keep in mind

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
- A `workload` aggregate built from Query History is the sample of this exact statement's executions
  that happen to be saved locally — not a random or complete sample of every partition/key value the
  statement has ever run against; a wide spread between its minimum and maximum filter pass rate
  points at that skew, not at a single "typical" rate.
