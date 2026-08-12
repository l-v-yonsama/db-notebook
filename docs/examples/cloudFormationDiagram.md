# Creating CloudFormation diagrams

Database Notebook can generate a diagram from one or more CloudFormation stacks in an AWS
connection. It reads each selected stack's template and can produce an application flow, a
CloudFormation dependency graph, or a Multi-AZ deployment and data-path diagram in Mermaid or
editable draw.io format.

## TOC

- 1. [Prerequisites](#1-prerequisites)
- 2. [Create an AWS connection for CloudFormation](#2-create-an-aws-connection-for-cloudformation)
- 3. [Open the diagram settings](#3-open-the-diagram-settings)
- 4. [Select a diagram mode](#4-select-a-diagram-mode)
  - 4.1. [ApplicationDiagram](#41-applicationdiagram)
  - 4.2. [CfnDependencyGraph](#42-cfndependencygraph)
  - 4.3. [MultiAzDeploymentTrafficPathsAndProtection](#43-multiazdeploymenttrafficpathsandprotection)
- 5. [Dependency graph options](#5-dependency-graph-options)
- 6. [Select an output format](#6-select-an-output-format)
  - 6.1. [Mermaid preview notebook](#61-mermaid-preview-notebook)
  - 6.2. [draw.io editable file](#62-drawio-editable-file)
- 7. [Generate the diagram](#7-generate-the-diagram)
- 8. [Troubleshooting and limitations](#8-troubleshooting-and-limitations)

## 1. Prerequisites

- Open a workspace folder in VS Code. The generated preview file is written to the first
  workspace folder, so diagram generation cannot finish with only an individual file open.
- Configure an AWS connection in Database Notebook with the **CloudFormation** service enabled.
- The configured AWS credentials need read access to the CloudFormation APIs used to discover
  stacks and load their templates, including `cloudformation:ListStacks`,
  `cloudformation:DescribeStackResources`, and `cloudformation:GetTemplate`.
- Connect or refresh the AWS connection so its CloudFormation stacks appear in the DB Explorer.

For Mermaid output, install
[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)
so Mermaid code blocks are rendered as diagrams. For draw.io output, install
[Draw.io Integration](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio)
to open the generated file in an editable diagram editor inside VS Code.

## 2. Create an AWS connection for CloudFormation

In the Database Notebook connection settings form:

1. Set **DB Type** to `Aws`.
2. Select the credential source and region used by the target AWS account.
3. Under **Services**, enable **CloudFormation**.
4. Save and connect.

The DB Explorer displays a **CloudFormation** service node with the stacks visible to the
configured credentials.

## 3. Open the diagram settings

In the DB Explorer, use **Create CloudFormation diagram** from either of these entry points:

- **CloudFormation service node**: opens the settings with every discovered stack initially
  selected.
- **One stack**: opens the settings with that stack initially selected.
- **Multiple selected stacks**: select the stack rows in the tree, then open the context menu on
  one of them. The selected stacks are initially checked in the settings.

The settings panel always lists every stack currently discovered for that connection. Use the
checkboxes, **Select all**, or **Clear** to choose what the generated diagram includes.

## 4. Select a diagram mode

The three modes answer different questions. `ApplicationDiagram` is the default.

| Mode                         | Best for                                    | What it emphasizes                                                                       |
| ---------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `ApplicationDiagram`         | Understanding an application's runtime flow | Ingress, compute, messaging, and data relationships recognized from the templates        |
| `CfnDependencyGraph`         | Auditing or investigating an IaC definition | CloudFormation dependencies such as `Ref`, `Fn::GetAtt`, `Fn::Sub`, and `DependsOn`      |
| `MultiAzDeploymentTrafficPathsAndProtection` | Understanding placement and data paths      | VPC, Availability Zone, and subnet placement plus template-evidenced communication paths |

### 4.1. ApplicationDiagram

Use this mode for the most concise, application-oriented view. It attempts to show meaningful
runtime paths—for example, an ingress resource invoking compute, compute publishing to a queue,
or compute accessing a data resource—rather than drawing every deployment dependency.

This mode intentionally omits many CloudFormation-only and auxiliary relationships. If a
resource or edge is absent, use `CfnDependencyGraph` to inspect the complete template dependency
structure.

### 4.2. CfnDependencyGraph

Use this mode when the CloudFormation definition itself is the subject of investigation. It can
include any resource type and follows explicit template dependencies instead of limiting the
diagram to application runtime relationships.

For Mermaid output, the **Viewpoint** and **Auxiliary resource treatment** settings described in
[section 5](#5-dependency-graph-options) apply only to this mode. A draw.io dependency graph
always includes every CloudFormation resource and ignores those two settings.

### 4.3. MultiAzDeploymentTrafficPathsAndProtection

Use this mode for templates containing network infrastructure. It arranges supported resources
around their VPC, Availability Zone, and subnet hierarchy, then adds ingress, egress, event, and
data-access paths that can be evidenced from the CloudFormation templates. It does not infer
traffic merely because two resources share a network.

For a template without VPC/subnet resources, `ApplicationDiagram` or `CfnDependencyGraph` is
usually more useful.

## 5. Dependency graph options

These controls are enabled only for Mermaid output in `CfnDependencyGraph`:

- **Viewpoint** filters or prioritizes the resource categories relevant to an Application,
  Infrastructure, Security, Database, or Operations view.
- **CloudFormation View** disables viewpoint filtering and includes every resource.
- **Auxiliary resource treatment** controls resources that support another resource rather than
  acting as a main application component:
  - **Merge into the related resource's label** keeps the graph compact.
  - **Separate group** displays auxiliary resources as their own unconnected group.
  - **Omit entirely** removes them from the diagram.

For draw.io output, `CfnDependencyGraph` always displays every CloudFormation resource. The
viewpoint and auxiliary-resource settings are disabled because the renderer does not use them.

**Include relationship legend** adds or removes the legend explaining edge styles. This option
is available for every diagram mode.

## 6. Select an output format

### 6.1. Mermaid preview notebook

Select **Mermaid (preview notebook)** to create or update:

```text
<workspace root>/preview.cfn-diagram.dbn
```

The preview notebook contains:

1. A Markdown cell with the generated Mermaid diagram.
2. A Markdown cell containing the YAML CloudFormation template for each selected stack.

Generating again reuses the same file. When updating a preview created by this feature, its
previous generated preview/template cells are replaced and other cells are preserved.

### 6.2. draw.io editable file

Select **draw.io (editable XML file)** to create or update:

```text
<workspace root>/preview.cfn-diagram.drawio
```

The draw.io document also contains a source page for each selected stack. Resource cards link to
their stack's source page, which contains the CloudFormation template used to generate the
diagram.

When Draw.io Integration is installed, Database Notebook opens the file directly in its VS Code
editor. Without that extension, the `.drawio` file is still created and its path is shown, so it
can be opened later with diagrams.net or another compatible editor.

Node placement and connector routing are computed automatically (via
[ELK](https://www.npmjs.com/package/elkjs)) instead of a fixed layout, so generation is
asynchronous and can take noticeably longer for a large template or many selected stacks. If
layout does not finish within a few seconds, it falls back to a simpler grid placement
automatically — every resource and relationship still appears, only the arrangement looks less
polished. `Multi-AZ Deployment, Traffic Paths & Protection`'s VPC/Availability Zone/Subnet nesting
is never rearranged by this automatic layout; only the resources placed *inside* a subnet are
auto-arranged.

## 7. Generate the diagram

1. Check one or more stacks.
2. Select the diagram mode.
3. For Mermaid `CfnDependencyGraph`, select the viewpoint and auxiliary resource treatment.
4. Select Mermaid or draw.io output.
5. Choose whether to include the relationship legend.
6. Click **Generate**.

Database Notebook reconnects with the saved AWS connection, retrieves the current template for
each selected stack, writes the fixed preview file, and opens it in VS Code.

## 8. Troubleshooting and limitations

- **No CloudFormation stacks found**: confirm that CloudFormation is enabled under the
  connection's Services, reconnect or refresh the connection, and verify the configured account
  and region.
- **Access denied**: grant the CloudFormation read actions listed in [section 1](#1-prerequisites)
  to the selected profile or credentials.
- **The preview file is not created**: open a workspace folder. Preview files are not written
  when VS Code has no workspace folder.
- **Mermaid source is visible but no diagram is rendered**: install or enable Markdown Preview
  Mermaid Support, then reopen the preview notebook.
- **The draw.io file is created but does not open in an editor**: install Draw.io Integration or
  open `preview.cfn-diagram.drawio` manually.
- **A runtime relationship is missing from ApplicationDiagram**: the diagram is derived from
  static CloudFormation templates and the relationship rules supported by Database Notebook; it
  does not inspect live application traffic. Try `CfnDependencyGraph` for the underlying template
  dependencies.
- **Regeneration changes an existing preview**: the two preview filenames are intentionally
  fixed and reused. Rename or copy a preview file before generating again if it needs to be kept
  as a separate artifact.
