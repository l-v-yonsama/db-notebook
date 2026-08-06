# Drawing an AWS Architecture Diagram with AI

Database Notebook has no dedicated "draw a diagram" command for AWS resources, and doesn't
bundle a Mermaid renderer either. Instead, the same [`#getDbSchema`](./lmToolsUsageGuide.md#53-get-database-schema--getdbschema)
tool used for relational DDL also returns a plain-text description of your AWS resources — and it
turns out that's enough on its own. GitHub Copilot Chat (or any other MCP-capable AI client, see
the [MCP Server Usage Guide](./mcpServerUsageGuide.md)) can read that text and draw a Mermaid
diagram from it directly, with no extra tooling — **as long as you also tell it where to put the
result**, using [`#createDbNotebook`](./lmToolsUsageGuide.md#57-create-database-notebook--createdbnotebook).
Left unstated, the AI has no reason to know you want a `.dbn` notebook with one Mermaid-only cell
rather than, say, a full Jupyter analysis notebook — see [§5](#5-troubleshooting) for exactly that
failure mode.

## 1. Prerequisites

- An AWS connection configured in the DB Explorer, with **AI tool access enabled** (the connection
  settings form's "Allow AI tools (e.g. Copilot Chat) to check and query this connection"
  checkbox — see [§2.1 of the LM Tools guide](./lmToolsUsageGuide.md#21-enable-a-connection-for-ai-tool-use)).
- The **CloudFormation** service checked in that connection's AWS settings, alongside whatever
  other services (S3/SQS/SES/Cloudwatch/DynamoDB/SSM/SecretsManager) you also want on the diagram.
- The "[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)"
  extension (same one the README recommends for ER diagrams) so a fenced ` ```mermaid ` block
  renders as a picture in VS Code's Markdown preview instead of staying as text.

## 2. Steps

**Don't just say "visualize it" — say exactly where the diagram should land.** A vague prompt like
"mermaidで可視化して" gives Copilot no reason to reach for `#createDbNotebook`, and it's just as
likely to improvise a whole Python/Jupyter analysis notebook (data-loading cells, a hand-rolled
AWS-resource → Mermaid conversion function, unit tests, `.mmd` file exports...) as it is to give you
the one thing you actually asked for. Name the tool and the shape of the output explicitly:

1. In Copilot Chat (Agent mode):

   > #getDbSchema connectionName="myAwsConnection" で AWS リソース定義を取得し、その結果を使って
   > #createDbNotebook で新しい .dbn ノートブックを1つ作成してください。ノートブックには markup
   > セルを1つだけ含め、そのセルの内容として ` ```mermaid ` フェンスで囲んだ Mermaid の構成図を
   > 直接書いてください。データ変換用のコードセルや Python/Jupyter のノートブック、別ファイルへの
   > エクスポートは不要です — markup セル1つと、その中の Mermaid コードだけで完結させてください。
   > **矢印(関係線)は #getDbSchema のテキストに明示的に書かれている関係(例: `DLQ:` 行、CloudFormation
   > の `depends on:` 行)だけを描いてください。リソース名が似ている・一般的なAWSのベストプラクティス
   > といった理由で関係を推測して描かないでください。** 根拠のある関係が無いリソースは、矢印で結ばず
   > 独立したノードのまま描いてください。

   (EN equivalent: *"Fetch AWS resource definitions with `#getDbSchema` for `myAwsConnection`, then
   use `#createDbNotebook` to create one new `.dbn` notebook containing exactly one markup cell,
   whose content is a Mermaid diagram in a fenced ` ```mermaid ` block. No code cells, no
   Python/Jupyter notebook, no exported files — just that one markup cell. **Only draw an arrow
   between two resources when the `#getDbSchema` text explicitly states a relationship (a `DLQ:`
   line, a CloudFormation `depends on:` line, etc.) — do not infer a relationship just because two
   resource names look related, or because it's a common AWS pattern. Leave resources with no
   stated relationship as unconnected nodes."*)

2. Copilot should reply having called `#getDbSchema` then `#createDbNotebook` with a
   `cells: [{ "kind": "markup", "value": "```mermaid\n...\n```" }]` tool input (see
   [§5.7 of the LM Tools guide](./lmToolsUsageGuide.md#57-create-database-notebook--createdbnotebook)
   for the exact shape) — open the resulting `.dbn` file to see the rendered diagram.

If you'd rather keep the diagram as a plain Markdown file instead of a notebook, ask for that
explicitly too (e.g. "...as a fenced mermaid block in a new `docs/aws-diagram.md` file") and open
it with the Markdown preview instead.

No separate confirmation dialog is needed for `#getDbSchema` (read-only) or `#createDbNotebook`
(refuses to overwrite anything, so it never asks either — see
[§4 of the LM Tools guide](./lmToolsUsageGuide.md#4-confirmation-dialogs)).

## 3. What ends up on the diagram

`#getDbSchema` lists every CloudFormation stack under a `-- CloudFormation --` /
`--- Stacks --` heading, one block per stack, with each stack's resources
(`LogicalResourceId`/`ResourceType`/`PhysicalResourceId`) indented underneath it — so Copilot can
draw a stack as a group node containing its resources, the same way it already groups an S3
bucket's owner or a DynamoDB table's indexes.

```
-- CloudFormation --
--- Stacks (1 stack) ---
- OrderProcessingStack (status: CREATE_COMPLETE)
    OrderQueue (AWS::SQS::Queue, physical: https://sqs.../OrderQueue)
    OrderQueueDLQ (AWS::SQS::Queue, physical: https://sqs.../OrderQueueDLQ)
    ProcessOrderFunction (AWS::Lambda::Function, physical: arn:aws:lambda:...)
```

**What this does *not* include yet:** the arrows *between* those resources — i.e. that
`ProcessOrderFunction` actually reads from `OrderQueue`, or that `OrderQueueDLQ` is its dead-letter
queue. That relationship lives in the CloudFormation template's own `Ref`/`Fn::GetAtt`/`DependsOn`
declarations, which today's schema output doesn't parse out yet (a template-parsing pass is
planned as a follow-up). Until then, Copilot can only draw the stack/resource *containment*
hierarchy shown above, not the wiring inside it.

One relationship *is* already available today, independently of CloudFormation: SQS's own
`RedrivePolicy` tells you which queue is another queue's dead-letter target, and
`#getDbSchema`'s `-- SQS --` section already renders that as `DLQ: <arn> (maxReceiveCount: N)` on
the source queue. Copilot can turn that into an edge on the same diagram even for queues that
aren't part of any CloudFormation stack at all.

## 4. Example prompt/response

> User: #getDbSchema connectionName="prodAws" で AWS リソース定義を取得し、#createDbNotebook で
> aws-diagram.dbn を作成してください。markup セルを1つだけ含め、内容は CloudFormation スタックを
> Mermaid の階層図にしたものにしてください。コードセルや Python は不要です。

> Copilot calls `#getDbSchema`, then `#createDbNotebook` with:
> ```json
> {
>   "notebookPath": "aws-diagram.dbn",
>   "connectionName": "prodAws",
>   "cells": [
>     {
>       "kind": "markup",
>       "value": "```mermaid\nflowchart TB\n  subgraph OrderProcessingStack\n    OrderQueue[\"OrderQueue (AWS::SQS::Queue)\"]\n    OrderQueueDLQ[\"OrderQueueDLQ (AWS::SQS::Queue)\"]\n    ProcessOrderFunction[\"ProcessOrderFunction (AWS::Lambda::Function)\"]\n  end\n```"
>     }
>   ]
> }
> ```
> ...and opens `aws-diagram.dbn`, showing the rendered diagram in its one markup cell.

If you also want the DLQ relationship drawn as an arrow, ask for it explicitly (e.g. "also draw an
arrow from OrderQueue to its DLQ") — Copilot has that information from the `-- SQS --` section, it
just isn't guaranteed to draw it unprompted.

## 5. Troubleshooting

**Copilot built a whole Jupyter (`.ipynb`) analysis notebook instead of one diagram.** This is
what happens when the prompt just says something like "mermaidで可視化して" with no mention of
`#createDbNotebook` or of a `.dbn` file. Copilot then falls back to its general-purpose instinct —
data cells, a hand-written AWS→Mermaid conversion function, unit tests for that function, `.mmd`
file exports — none of which uses Database Notebook's own tooling at all, and produces a `.ipynb`
file (a different notebook format entirely) rather than a `.dbn` one. Fix: name `#createDbNotebook`
explicitly, say `.dbn`, and say "one markup cell, no code cells" — see the prompt template in
[§2](#2-steps). If Copilot still free-lances, add "don't write any Python or analysis code, just
the Mermaid text" as an explicit constraint.

**The `.dbn` file's markup cell shows raw ` ```mermaid ` text instead of a rendered picture.**
Confirm the [Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)
extension from [§1](#1-prerequisites) is installed and enabled — it's what turns the fenced code
block into a picture inside a rendered markup cell, the same way it already does for this
extension's own ER diagrams.

**The diagram draws arrows that don't correspond to anything in the schema text.** Once the
"one markup cell" problem above is fixed, a *second*, subtler failure can show up: Copilot fills in
plausible-looking relationships that were never actually in the `#getDbSchema` output — e.g. drawing
an "SQS queue logs to CloudWatch" edge to a log group that's actually unrelated (say, a Lambda's own
log group), or an "SSM parameter references this Secrets Manager secret" edge based purely on the
two names sounding related. This isn't a rendering bug, it's the model pattern-matching against
general AWS architecture knowledge to make an otherwise sparse diagram "feel complete" — and it's
easy to miss because the fabricated arrows are drawn with the same visual confidence as a real one
(e.g. the actual SQS `DLQ:` relationship). It's worth treating with extra caution for SSM/Secrets
Manager specifically: their values are deliberately never exposed to AI tools at all (see
[the LM Tools guide's scan section](./lmToolsUsageGuide.md#56-scan-database-resource--scandbresource)),
so any relationship Copilot claims between a parameter and a secret can only ever be a guess from
their names, never something it actually verified.

Fix: use the "only draw a documented relationship" constraint from the prompt template in
[§2](#2-steps), and treat every arrow in the result as a claim to spot-check against the raw
`#getDbSchema` text, not as ground truth. If a stated resource has no real relationship in the
data, expect it to end up as an unconnected node — for now, that will be most non-CloudFormation,
non-SQS-DLQ resources, since those two are the only relationship signals available today (see
[§3](#3-what-ends-up-on-the-diagram)).
