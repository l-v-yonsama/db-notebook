# Database Notebook

Database Notebook is a Visual Studio Code extension that allows access to various databases through the VSCODE Notebook interface.

![logo](./media/logo128.png)

## Features

- Various databases accesss in Notebooks, Sidebars and panels UI
  - MySQL, Postgres, Redis, AWS
- Run & stop SQL, JavaScript code in node.js
- Variable sharing between notebook cells
- ER diagram creation in [mermaid format](https://mermaid.js.org/syntax/entityRelationshipDiagram.html)
- Provide IntelliSense using DB resource names and coments
- Convenient visualization of result sets
  - Difference display using comparison key (Primary or Unique key)
  - Label display using code label resolver
  - Display of record rule validation errors
  - Output in Excel file format

## Getting started

- Setup connection settings
- Access to database
  - through the SidePanel
  - through the Notebook

## Examples

- Setup connection settings, access to Mysql through the Side-panel

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/01_setup.gif)

- Access to Mysql through the Notebook ( `Create a new blank Database Notebook` )

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/02_notebook.gif)

- Variable sharing between notebook cells

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/03_variable_sharing.gif)

- ER diagram creation in mermaid format

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/04_er_diagram.gif)

- Label display using code label resolver

  - ![](https://raw.githubusercontent.com/l-v-yonsama/db-notebook/main/docs/images/06_label_display.gif)

## Requirements

- node.js >= 14.14

## Recommended Extensions

The ER diagram is output in mermaid format.
It is recommended to use the "[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)" extension together to visualize it.
