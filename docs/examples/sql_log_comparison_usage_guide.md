# SQL Log Comparison Usage Guide

Compare SQL extracted from two application logs and save the results as an Excel report. The report shows SQL differences, WHERE condition comparisons, and links to the original log lines.

## Before you start

- Prepare two different log files: **Before** (the earlier run) and **After** (the later run).
- Prepare a saved `*.log-parser.config.json` file for each log. You can use the same config for both logs if they have the same format. Each config must be able to extract SQL; see the [Log Parser Usage Guide](log_parser_usage_guide.md) to create and verify one.
- Choose a local folder for the Excel report.

## Compare the logs

1. In the VS Code Explorer, right-click a `.log` file and select **Compare SQL logs**. You can also select up to two log files in the Explorer before opening the command, or run **DB Notebook Log Viewer: Compare SQL logs** from the Command Palette.
2. In **Input**, check the **Before** and **After** log files. Use **Select** to choose or change either file. **Swap** reverses the two sides and their parser configs.
3. Choose a **Parser config** for each side from the dropdown, or use **Select** to browse for one. The config can differ between the two logs. A config previously used successfully with a log may be restored automatically.
4. In **Output**, check the folder. For a local Before log, its folder is selected by default; use **Select** to change it.
5. In **Comparison options**, choose the **Dialect** used by the SQL in both logs and adjust the equivalent SQL rules if needed. The **Equivalent SQL example** is a fixed sample showing how the selected rules work; it is not a preview of your log files.
6. Select **Compare**. After the completion message appears, select **Open Report** to open the generated Excel file.

The report is saved as `sql-log-comparison-YYYYMMDD-HHmmss-SSS.xlsx` in the selected folder. The two log files must be different, and the output folder must be local.

## Equivalent SQL rules

The rules determine whether SQL that differs after formatting can still be treated as equivalent. They do not change the original SQL shown in the report.
The defaults below apply on first use; your rule selections are remembered for later comparisons.

| Rule | Default | Effect |
| --- | --- | --- |
| Equivalent date functions | On where supported | Treats `NOW()` and `CURRENT_TIMESTAMP` as equivalent in MySQL and PostgreSQL, or `GETDATE()` and `CURRENT_TIMESTAMP` in Transact-SQL. Unavailable for SQLite and Oracle (PL/SQL). |
| Ignore date-time literal values | Off | Ignores differences between complete date-time literal values. Enable only when those values are expected to vary. |
| Redundant WHERE parentheses | On | Ignores unnecessary parentheses around WHERE conditions. |
| Ignore case in unquoted identifiers | Off | Treats unquoted names such as `Created_At` and `created_at` as equivalent. |
| Ignore single-table aliases | Off | Ignores simple unquoted aliases for a single table. |
| Ignore ordinary comments | On | Ignores ordinary SQL comments. |
| Ignore optimizer hint comments | Off | Ignores optimizer hints such as `/*+ ... */`. |

Alias and date-time literal rules can also affect the **WHERE match** result. Choose rules according to what counts as a meaningful change for your review.

## Read the Excel report

The workbook has two sheets:

- **Result** starts with an overall result and counts of extracted SQL and comparison statuses. Its list links to a detailed section for each SQL statement. Each section shows the SQL match level, WHERE match, source-log links, original bind information when available, and formatted and equivalent SQL differences.
- **Log** shows the full Before and After logs side by side with line numbers. Lines associated with extracted SQL are highlighted. Follow a source link from **Result** to inspect the original lines.

| SQL match level | Meaning |
| --- | --- |
| Matched | The formatted SQL matches. |
| Equivalent match | The formatted SQL differs, but it matches under the selected equivalent SQL rules. |
| Different | The SQL comparison found a difference. |
| Not comparable | The statement could not be compared reliably; check the reason and the source logs. |

Review **WHERE match** separately from the SQL match level. It can be **Matched**, **Different**, **Not comparable**, or `-` when it does not apply. A missing counterpart or incomplete extraction may appear as **Not comparable**. If the report says **Review required**, check the reasons, unclassified events, and source lines before drawing a conclusion. An **All extracted SQL matched** result covers SQL extracted by the selected parser configs; it does not validate events those configs failed to classify.
