# Database Notebook

Database Notebook is a Visual Studio Code extension that allows access to various databases through the VSCODE Notebook interface.

It also provides a CSV and Har file preview feature.

![logo](./media/logo128.png)

## Features

- Various databases accesss in Notebooks, Sidebars and panels UI
  - MySQL, PostgreSQL, Redis, AWS, Keycloak, Auth0
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
- Create and execute "Undo changes sql statements"
- File preview
  - CSV file preview
  - Har file preview

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

<details>

<summary>Screenshots ( Convenient visualization of result sets )</summary>

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

<summary>Screenshots ( Access to the Keycloak from the side panel )</summary>

<div>

### Access to the Keycloak from the side panel to display changes in user information.

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/08_keycloak.gif)

### Expand and display JSON items in columns.

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/09_json_expansion.gif)

</div>

</details>

<details>

<summary>Screenshots ( File viewer )</summary>

<div>

### Csv file viewer

- After previewing the CSV file, descriptive statistics were displayed according to its content.

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/10_csv_viewer.gif)

### Har file viewer

- ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/11_har_viewer.gif)

</div>

</details>

## Examples

- [Database Notebook file examples](/docs/examples/databaseNotebook.md)

## Requirements

- node.js >= 18

## Recommended Extensions

The ER diagram is output in mermaid format.
It is recommended to use the "[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)" extension together to visualize it.

## 🎁 Donate

<a href="https://www.buymeacoffee.com/lvyoshiokaI">
  <img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174">
</a>
