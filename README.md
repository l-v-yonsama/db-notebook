# Database Notebook

Database Notebook is a Visual Studio Code extension that allows access to various databases through the VSCODE Notebook interface.

![logo](./media/logo128.png)

## Features

- Various databases accesss in Notebooks, Sidebars and panels UI
  - MySQL, Postgres, Redis, AWS, Keycloak, Auth0
- Run & stop SQL, JavaScript code in node.js
- Variable sharing between notebook cells
- ER diagram creation in [mermaid format](https://mermaid.js.org/syntax/entityRelationshipDiagram.html)
- Provide IntelliSense using DB resource names and coments
- Convenient visualization of result sets
  - Difference display using comparison key (Primary or Unique key)
  - Label display using code label resolver
  - Verify result sets comply with a rule.
  - Output in Excel file format
- Create and execute "Undo changes sql statements"

## Screenshots

- Setup connection settings, access to Mysql through the Side-panel

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/01_setup.gif)

- Access to Mysql through the Notebook ( `Create a new blank Database Notebook` )

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/02_notebook.gif)

- Variable sharing between notebook cells

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/03_variable_sharing.gif)

- ER diagram creation in mermaid format

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/04_er_diagram.gif)

- Difference display using comparison key (Primary or Unique key)

  - Create and execute "Undo changes sql statements"

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/05_diff.gif)

- Label display using code label resolver ( `Create a new blank Code label resolver` )

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/06_label_display.gif)

- Verify records comply with a rule ( `Create a new blank DB record rule` )

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/07_record_rule.gif)

## Examples

- [Database Notebook file examples](/docs/examples/databaseNotebook.md)

## Requirements

- node.js >= 16

## Recommended Extensions

The ER diagram is output in mermaid format.
It is recommended to use the "[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)" extension together to visualize it.

## 🎁 Donate

<a href="https://www.buymeacoffee.com/lvyoshiokaI">
  <img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174">
</a>
