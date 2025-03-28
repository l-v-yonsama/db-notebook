import {
  AwsDatabase,
  createTableDefinisionsForPrompt,
  RdsDatabase,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import { CancellationTokenSource, env, LanguageModelChatMessage, lm, NotebookCell } from "vscode";
import { LMContent, LMResult, RunResultMetadata } from "../shared/RunResultMetadata";
import { CellMeta, LMPromptCreateConditions } from "../types/Notebook";
import { StateStorage } from "./StateStorage";

const ASSISTANT_ANNOTATION_PROMPT = `You are a code tutor helping students learn to write better SQL and a database specialist.
Your job is to evaluate the SQL statements provided by the user and annotate them with simple suggestions and reasons for improvement.
Approach the suggestions with a friendly attitude, remembering that they are students and need gentle guidance.
Provide suggestions regarding readability, performance, accuracy, style, and other SQL best practices.
Assume that bind variables and placeholders are used correctly and do not need to be pointed out.`;

type CreatePromptParams = {
  db: AwsDatabase | RdsDatabase;
  explainRdh?: ResultSetData;
  dbProduct: string;
  sql: string;
  withJSONResponseFormartForEngine: boolean;
} & Omit<LMPromptCreateConditions, "languageModelId">;

export const createPrompt = (params: CreatePromptParams): { assistant: string; user: string } => {
  const {
    db,
    dbProduct,
    sql,
    explainRdh,
    translateResponse,
    withTableDefinition,
    withRetrievedExecutionPlan,
    withJSONResponseFormartForEngine,
  } = params;
  const assistantContents: string[] = [];
  let tableDefinitionsContent: string | undefined = undefined;
  if (withTableDefinition) {
    tableDefinitionsContent = createTableDefinisionsForPrompt({
      db,
      sql,
    });
  }

  assistantContents.push(ASSISTANT_ANNOTATION_PROMPT);

  if (withJSONResponseFormartForEngine) {
    assistantContents.push("");
    assistantContents.push("Format the suggestions in stringified with JSON.stringify.");
    assistantContents.push("");
    assistantContents.push(
      "If there are no suggestions, the response 'contents' will be an empty array."
    );
    assistantContents.push(
      "If no modification of the SQL statement is required, the response 'sqlAfterModification' will be empty."
    );
    assistantContents.push(
      "If there is a proposed modification to the SQL statement, Consider readability and insert line breaks as appropriate to make the content easier to read."
    );
    assistantContents.push("In this case, use '\n' as the line feed character.");
    assistantContents.push(
      "The proposed modification should be described in the 'sqlAfterModification' section of the response."
    );
    assistantContents.push("");

    if (withRetrievedExecutionPlan && explainRdh) {
      assistantContents.push(
        "Comments on the content of the 'explain plan' should be included in the 'commentOfExplainPlan' section of the response."
      );
      assistantContents.push(
        "However, if there is no comment on the 'explain plan', it is assumed to be a blank character."
      );
      assistantContents.push("");
    }
    assistantContents.push("You can also provide links to references for the suggestions.");
    assistantContents.push(
      "It is not necessary to enclose the JSON string of the reply content in '```json\n~\n```'."
    );
    assistantContents.push("Here is an example of how the response should look:");
    assistantContents.push("");

    const exampleObj: any = {
      sqlAfterModification:
        "SELECT\n  first_name,\n  last_name,\n  FORMAT(2, '9999') \nFROM employees",
      contents: [
        {
          row: 2,
          col: 3,
          message: "Please review the selection 'first_name' as it is duplicated.",
        },
        {
          row: 2,
          col: 6,
          message:
            "The second argument of the FORMAT function should be passed as a string. Please use '2'.",
          reference: { title: "String Functions and Operators", url: "https://..." },
        },
      ],
    };
    if (withRetrievedExecutionPlan && explainRdh) {
      exampleObj.commentOfExplainPlan =
        "Please consider indexing because of the full scan in the backward matching search section.";
    } else {
      exampleObj.commentOfExplainPlan = "";
    }
    assistantContents.push(JSON.stringify(exampleObj));
  }

  //-------------------------------------
  // USER
  const userContents: string[] = [];

  const userContentsDetails: string[] = [];

  userContents.push("Evaluate the SQL statements described below.");
  userContents.push(`Target database is “${dbProduct}”.`);

  userContentsDetails.push("# Target SQL statement");
  userContentsDetails.push("");
  userContentsDetails.push("```sql");
  userContentsDetails.push(sql);
  userContentsDetails.push("```");

  if (withTableDefinition && tableDefinitionsContent) {
    userContents.push(
      'Related "Table definitions" will also be shared so that you can refer to them for evaluation if necessary.'
    );
    userContentsDetails.push("");
    userContentsDetails.push(`# Table definitions`);
    userContentsDetails.push("");
    userContentsDetails.push("```text");
    userContentsDetails.push(tableDefinitionsContent);
    userContentsDetails.push("```");
  }

  if (withRetrievedExecutionPlan && explainRdh) {
    userContents.push(
      '"Explain plans" will also be shared so that you can refer to them for evaluation if necessary.'
    );

    userContentsDetails.push("");
    userContentsDetails.push(`# Explain plans`);
    userContentsDetails.push("");
    userContentsDetails.push("```markdown");
    userContentsDetails.push(
      ResultSetDataBuilder.from(explainRdh).toMarkdown({ maxCellValueLength: 5000 })
    );
    userContentsDetails.push("```");
  }

  if (translateResponse) {
    // ユーザーの利用言語を取得
    if (env.language) {
      userContents.push(`Translate your response into the following language: ${env.language}`);
    }
  }
  userContents.push("");
  userContents.push(...userContentsDetails);

  return {
    assistant: assistantContents.join("\n") + "\n",
    user: userContents.join("\n") + "\n",
  };
};

export const runLm = async (
  stateStorage: StateStorage,
  cell: NotebookCell,
  metadata: RunResultMetadata,
  cancellationTokenSourceList: CancellationTokenSource[] | undefined
): Promise<void> => {
  const { connectionName }: CellMeta = cell.metadata;
  const { lmPromptCreateConditions } = cell.metadata as CellMeta;
  if (!connectionName || !lmPromptCreateConditions) {
    return;
  }
  const dbs = stateStorage.getResourceByName(connectionName);
  if (!dbs || dbs.length === 0) {
    return;
  }
  let [model] = await lm.selectChatModels({ id: lmPromptCreateConditions?.languageModelId });

  const dbProduct = stateStorage.getDBProductByConnectionName(connectionName);
  if (!dbProduct) {
    return;
  }

  const explainOutputMetadata: RunResultMetadata | undefined = cell.outputs.find(
    (it) => it.metadata?.explainRdh || it.metadata?.analyzedRdh
  )?.metadata;

  const prompt = createPrompt({
    db: dbs[0] as AwsDatabase | RdsDatabase,
    dbProduct,
    sql: cell.document.getText(),
    explainRdh: explainOutputMetadata?.explainRdh ?? explainOutputMetadata?.analyzedRdh,
    translateResponse: lmPromptCreateConditions.translateResponse,
    withTableDefinition: lmPromptCreateConditions.withTableDefinition,
    withRetrievedExecutionPlan: lmPromptCreateConditions.withRetrievedExecutionPlan,
    withJSONResponseFormartForEngine: true,
  });

  const messages = [
    LanguageModelChatMessage.Assistant(prompt.assistant),
    LanguageModelChatMessage.User(prompt.user),
  ];

  // make sure the model is available
  if (model) {
    const lmResult: LMResult = {
      model: {
        id: model.id,
        vendor: model.vendor,
        family: model.family,
        version: model.version,
      },
      contents: [],
      ok: false,
      markdownText: "`[AI assistant Response]` ",
      elapsedTime: 0,
    };

    metadata.lmResult = lmResult;
    let start = Date.now();
    // send the messages array to the model and get the response
    const cts = new CancellationTokenSource();
    cancellationTokenSourceList?.push(cts);
    let chatResponse = await model.sendRequest(messages, {}, cts.token);

    // handle chat response
    let accumulatedResponse = "";

    for await (const fragment of chatResponse.text) {
      if (cts.token.isCancellationRequested) {
        lmResult.markdownText += "The request was cancelled.";
        return;
      }
      accumulatedResponse += fragment;
    }

    const res: {
      sqlAfterModification: string;
      commentOfExplainPlan: string;
      contents: LMContent[];
    } = JSON.parse(accumulatedResponse);

    if (
      res.sqlAfterModification &&
      res.sqlAfterModification.trim() === cell.document.getText().trim()
    ) {
      res.sqlAfterModification = "";
    }

    lmResult.contents = res.contents;
    lmResult.ok = true;
    lmResult.elapsedTime = Date.now() - start;
    lmResult.markdownText += `model: ${model.family} (${(lmResult.elapsedTime / 1000).toFixed(
      2
    )} sec)\n`;
    if (lmResult.contents.length === 0) {
      lmResult.markdownText += "No suggestions were provided.";
    } else {
      lmResult.markdownText += `| No | Position | Message | Doc reference | \n`;
      lmResult.markdownText += `| ---: | :---: | :--- | :--- | \n`;
      lmResult.contents.forEach((c, idx) => {
        lmResult.markdownText += `| ${idx + 1} | ${c.row},${c.col} | ${c.message} | `;
        if (c.reference) {
          lmResult.markdownText += ` [${c.reference.title}](${c.reference.url}) | \n`;
        } else {
          lmResult.markdownText += ` - | \n`;
        }
      });

      if (res.sqlAfterModification) {
        lmResult.markdownText += "\n`[SQL statement after modification]`\n```sql\n";
        lmResult.markdownText += `${res.sqlAfterModification}\n`;
        lmResult.markdownText += `\`\`\`\n`;
      }

      if (
        res.commentOfExplainPlan &&
        (explainOutputMetadata?.explainRdh ?? explainOutputMetadata?.analyzedRdh)
      ) {
        lmResult.markdownText += "\n`[Comment of the explain plan]`\n\n";
        lmResult.markdownText += `${res.commentOfExplainPlan}\n`;

        const rdh = explainOutputMetadata?.explainRdh ?? explainOutputMetadata?.analyzedRdh;
        lmResult.markdownText += `\n`;
        lmResult.markdownText += `${ResultSetDataBuilder.from(rdh).toMarkdown({
          maxCellValueLength: 2000,
        })}\n`;
      }
    }
  } else {
    metadata.lmResult = {
      model: undefined,
      contents: [],
      ok: false,
      elapsedTime: 0,
      markdownText: "`[AI assistant Response]` The language model was unavailable.",
    };
  }
};
