# Database Notebook

Database Notebook is a Visual Studio Code extension that allows access to various databases through the VSCODE Notebook interface.

It also provides a CSV and Har file preview feature.

![logo](./media/logo128.png)

## Features

- Various databases accesss in Notebooks, Sidebars and panels UI
  - MySQL, PostgreSQL, SQL Server, SQLite, Redis, AWS, Keycloak, Auth0
- Execute & stop SQL, JavaScript code in node.js
- Execute SQL mode
  - Execute query (Default)
  - Execute explain plan (Devises a query plan)
  - Execute explain analyze (Displays actual execution time and statistics)
- SQL history management
- Variable sharing between notebook cells
- ER diagram creation in [mermaid format](https://mermaid.js.org/syntax/entityRelationshipDiagram.html)
- Count the number of all tables belonging to the schema
- Provide IntelliSense using DB resource names and comments
- Convenient visualization of result sets
  - Difference display using comparison key (Primary or Unique key)
  - Label display using code label resolver
  - Verify result sets comply with a rule.
  - Output in Excel file format
  - Generate descriptive statistics
  - Support graphs
- Create and execute "Undo changes sql statements"
- Output notebook in HTML file format
- File preview
  - CSV file preview
  - Har file preview
- Evaluate SQL statements with AI
- Generate SQL queries effortlessly with AI

## Screenshots

- Setup connection settings, access to Mysql through the Side-panel

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/01_setup.gif)

- Access to Mysql through the Notebook ( `Create a new blank Database Notebook` )

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/02_notebook.gif)

- Execute SQL mode

  - Execute query (Default)
  - Execute explain plan (Devises a query plan)
  - Execute explain analyze (Displays actual
  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/13_sql_mode.gif)

- Variable sharing between notebook cells

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/03_variable_sharing.gif)

- ER diagram creation in mermaid format

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/04_er_diagram.gif)

- Format SQL statement

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/12_format.gif)

- Count the number of all tables belonging to the schema

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/15_count_for_all_tables.gif)

- Output notebook in HTML file format

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/16_html_report.gif)

- Create DB Notebook from a sql file

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/17_sql_to_dbn.gif)

- Evaluate SQL statements with AI

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/19_lm.gif)

- Generate SQL queries effortlessly with AI

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/20_chat2query.gif)

- Access to Aws( DynamoDB ) through the Notebook
  - On the DB Notebook, specify the number of counts in the LIMIT clause
  - ![](./docs/images/18_dynamoDB.png)

<details>

<summary>Screenshots ( Convenient visualization of result sets ) ( Click here )</summary>

<div>

### Difference display using comparison key (Primary or Unique key)

- Create and execute "Undo changes sql statements"

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

1. You can specify a default connection definition each time you add a new SQL cell to the notebook
   - ![](./docs/images/tips/01_default_connection.png)

## Examples

- [Database Notebook file examples](/docs/examples/databaseNotebook.md)
- [Database Notebook file chart examples](/docs/examples/databaseNotebookChart.md)
- [Database Notebook file Javascript cell examples](/docs/examples/databaseNotebookJs.md)

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
