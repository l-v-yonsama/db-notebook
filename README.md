# Database Notebook

Database Notebook is a Visual Studio Code extension that allows access to various databases through the VSCODE Notebook interface.

It also provides a CSV and Har file preview feature.

![logo](./media/logo128.png)

## Features

- Access various databases through Notebooks, Sidebars, and panel UIs
  - MySQL, PostgreSQL, SQL Server, SQLite, Redis, Memcached, AWS, Keycloak, Auth0, MQTT
- Execute & stop SQL, JavaScript code in node.js
- Execute SQL mode
  - Execute query (Default)
  - Execute explain plan (Generates a query plan).
  - Execute explain analyze (Displays actual execution time and statistics)
- SQL history management
- Variable sharing between notebook cells
  - See practical SQL examples using shared variables (LIKE, IN, exact match):
    [Variable sharing – LIKE and IN examples](/docs/examples/databaseNotebookVariableSharing.md)
- ER diagram creation in [mermaid format](https://mermaid.js.org/syntax/entityRelationshipDiagram.html)
- Count all tables in the schema
- Provide IntelliSense with database resource names and comments
- Intuitive visualization of result sets
  - Difference display using comparison key (Primary or Unique key)
  - Label display using code label resolver
  - Verify result sets comply with a rule.
  - Output in Excel file format
  - Generate descriptive statistics
  - Support graphs
- Create and execute SQL statements to undo changes
- Export notebook as an HTML file
- File preview
  - CSV file preview
  - Har file preview
- Evaluate SQL statements with AI
- Generate SQL queries with AI
- MQTT Client
  - Intuitive publish/subscribe interface
  - Query subscribed payloads using SQLite directly from the notebook

## Screenshots

- Setup connection settings, access to Mysql through the Side-panel

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/01_setup.gif)

- Access to Mysql through the Notebook ( `Create a new blank Database Notebook` )

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/02_notebook.gif)

- Execute SQL mode

  - Execute query (Default)
  - Execute explain plan (Generates a query plan).
  - Execute explain analyze (Displays actual
  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/13_sql_mode.gif)

- Variable sharing between notebook cells

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/03_variable_sharing.gif)

- ER diagram creation in mermaid format

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/04_er_diagram.gif)

- Format SQL statement

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/12_format.gif)

- Count all tables in the schema

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/15_count_for_all_tables.gif)

- Export notebook as an HTML file

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/16_html_report.gif)

- Create DB Notebook from an sql file

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/17_sql_to_dbn.gif)

- Evaluate SQL statements with AI

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/19_lm.gif)

- Generate SQL queries with AI

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/20_chat2query.gif)

- Access to Aws( DynamoDB ) through the Notebook

  - On the DB Notebook, specify the number of counts in the LIMIT clause
  - ![](./docs/images/18_dynamoDB.png)

- MQTT Client
  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/21_mqtt.gif)
  - [Database Notebook file MQTT examples](/docs/examples/databaseNotebookMQTT.md)

<details>

<summary>Screenshots ( Intuitive visualization of result sets ) ( Click here )</summary>

<div>

### Difference display using comparison key (Primary or Unique key)

- Create and execute SQL statements to undo changes

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/05_diff.gif)

### Label display using code label resolver ( `Create a new blank Code label resolver` )

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/06_label_display.gif)

### Verify records comply with a rule ( `Create a new blank DB record rule` )

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/07_record_rule.gif)

### Generate descriptive statistics

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/14_describe.gif)

</div>

</details>

<details>

<summary>Screenshots ( Access to the Keycloak from the side panel ) ( Click here )</summary>

<div>

### Access to the Keycloak from the side panel to display changes in user information.

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/08_keycloak.gif)

### Expand and display JSON items in columns.

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/09_json_expansion.gif)

</div>

</details>

<details>

<summary>Screenshots ( File viewer ) ( Click here )</summary>

<div>

### Csv file viewer

- After previewing the CSV file, descriptive statistics were displayed according to its content.

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/10_csv_viewer.gif)

### Har file viewer

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/11_har_viewer.gif)

</div>

</details>

## Tips

1. Instead of using VS Code’s built-in `Copy Cell` or `+ Code` / `Add Code Cell`, I recommend using `Duplicate Cell with Metadata`.
This action copies not only the cell content, but also all associated metadata—such as database connection settings and ResultSet decoration options—so you can add a new cell without reconfiguring these settings.
   - ![](./docs/images/tips/00_duplicate_cell.png)
1. You can specify a default connection definition each time you add a new SQL cell to the notebook
   - ![](./docs/images/tips/01_default_connection.png)

## Examples

- [Database Notebook file examples](/docs/examples/databaseNotebook.md)
- [Database Notebook file chart examples](/docs/examples/databaseNotebookChart.md)
- [Database Notebook file Javascript cell examples](/docs/examples/databaseNotebookJs.md)
- [Database Notebook file MQTT examples](/docs/examples/databaseNotebookMQTT.md)
- [Database Notebook file Variable sharing – SQL examples (LIKE / IN / exact match)](/docs/examples/databaseNotebookVariableSharing.md)

## Keyboard shortcuts

You can open this editor by going to the menu under Code > Settings > Keyboard Shortcuts or by using the Preferences: Open Keyboard Shortcuts command (⌘K ⌘S).

| Command                   | Keybindings | When                                                                                              | Source            |
| :------------------------ | :---------: | :------------------------------------------------------------------------------------------------ | :---------------- |
| Mark cell as skip or not  | ctrl+alt+s  | notebookType == 'database-notebook-type' && notebookCellListFocused && notebookCellType == 'code' | Database notebook |
| Specify connection to use | ctrl+alt+c  | notebookType == 'database-notebook-type' && notebookCellListFocused && cellLangId == 'sql'        | Database notebook |
| Notebook: cell execution  | ctrl+enter  | -                                                                                                 | System (default)  |

## Requirements

- node.js >= 18

## Recommended Extensions

The ER diagram is output in mermaid format.
It is recommended to use the "[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)" extension together to visualize it.

## 🎁 Donate

<a href="https://www.buymeacoffee.com/lvyoshiokaI">
  <img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174">
</a>
