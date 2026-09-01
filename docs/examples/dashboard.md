# Dashboard Guide

[日本語](dashboard.ja.md)

> **Experimental feature:** Dashboard availability, metrics, UI behavior, and the saved report format may change. Verify important findings with the database or AWS console before using them for operational decisions.

Database Notebook dashboards provide a focused view of database runtime statistics and AWS CloudWatch metrics from the DB Explorer. They are intended for interactive investigation, not continuous 24/7 monitoring.

## Supported dashboards

### Database dashboard

Database dashboards are available for supported MySQL, PostgreSQL, SQL Server, SQLite, and Oracle database resources. The panels vary by database engine, version, permissions, and endpoint.

The dashboard may show:

- workload rates and current activity;
- waits, locks, and session summaries;
- I/O, cache, storage, and capacity statistics;
- configuration or current-state values;
- collection notices, unavailable metrics, and statistics-reset markers.

### CloudWatch metrics dashboard

CloudWatch dashboards are available for supported AWS resources, including DynamoDB tables, S3 buckets, SQS queues, CloudWatch Logs log groups, SES, and service overview nodes where provided by the DB Explorer.

Some metrics are emitted only after resource activity or require additional AWS configuration. For example, some S3 request metrics are opt-in. CloudWatch API reads may incur AWS charges.

## Open a dashboard

1. Open the **DB Explorer** in the Database Notebook side panel.
2. Connect to and expand the database or AWS connection.
3. Right-click a resource that supports dashboards.
4. Select one of the available commands:
   - **Show database dashboard**
   - **Show CloudWatch metrics**
   - **Show CloudWatch metrics overview**

The menu item is shown only when the selected resource advertises the corresponding dashboard capability.

## Database sampling

Opening a database dashboard collects one initial snapshot. Periodic sampling does not start automatically.

- Select a sample interval and choose **Start sampling** to build a time-series history.
- Choose **Stop sampling** to stop collection while keeping the latest chart.
- Use **Refresh now** for one immediate sample.
- Hiding the dashboard stops periodic sampling. Start it again after returning if more history is needed.

Database sampling uses a dedicated observer connection and read-only monitoring queries. The observer itself can affect some global counters; affected series are marked in the dashboard. A short interval increases the relative observer impact and database load.

## CloudWatch refresh and cost

Use **Refresh** to retrieve the selected CloudWatch time range. Some dashboards also allow auto refresh. The toolbar shows the number of metric series requested per refresh as a cost indicator.

The dashboard does not enable AWS metrics or change resource configuration. Missing, delayed, or unavailable datapoints are shown as states or notices rather than converted to zero.

## Statuses and reset markers

- **Partial / unavailable:** Some metrics could not be collected because of permissions, version, endpoint, or source configuration.
- **Warming up:** A cumulative database counter needs another sample before a rate can be calculated.
- **Statistics reset / server restart:** A vertical marker indicates that a counter baseline changed. Lines are not joined across the reset.
- **Observer impact:** A note indicates whether the observer query is included, excluded, or unknown for a series.

## Export to a dashboard report

Choose **Export to Notebook** to save the data already displayed in the dashboard as a read-only `.dbnr` report. Exporting does not rerun database queries or CloudWatch requests.

Reports are saved below the first open workspace folder:

- CloudWatch: `reports/cw-metrics/`
- Database dashboard: `reports/rdb-dashboard/`

The report contains summary data, metric series, and diagnostics. Database reports also preserve reset markers and series without values as investigation evidence. Credentials, connection strings, SQL text, and raw driver errors are not included.
