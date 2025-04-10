import {
  DBDriverResolver,
  DbSchema,
  RDSBaseDriver,
  toCreateTableDDL,
  toViewDataNormalizedQuery,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { ResultSetData, ResultSetDataBuilder } from "@l-v-yonsama/rdh";
import {
  CancellationTokenSource,
  commands,
  env,
  LanguageModelChatMessage,
  lm,
  NotebookCell,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
} from "vscode";
import { OPEN_MDH_VIEWER } from "../constant";
import { MainController } from "../notebook/controller";
import { ActionCommand } from "../shared/ActionParams";
import { Chat2QueryConditionParams } from "../shared/Chat2QueryConditionParams";
import { ComponentName } from "../shared/ComponentName";
import { Chat2QueryPanelEventData } from "../shared/MessageEventData";
import { MdhViewParams } from "../types/views";
import { log, logError } from "../utilities/logger";
import { StateStorage } from "../utilities/StateStorage";
import { BasePanel } from "./BasePanel";

const PREFIX = "[Chat2QueryPanel]";

const ASSISTANT_ANNOTATION_PROMPT = `You are a database specialist.
Your job is to create queries using information provided by users.
You create queries with consideration for readability, performance, accuracy, style, and other SQL best practices.`;

type ResponseType = {
  explanation: string;
  query: string;
};

export class Chat2QueryPanel extends BasePanel {
  public static currentPanel: Chat2QueryPanel | undefined;
  private static stateStorage: StateStorage | undefined;
  private static controller: MainController | undefined;
  private cell: NotebookCell | undefined;
  private translateResponse = true;
  private withTableDefinition = false;
  private withSampleData = false;
  private commentType: Chat2QueryConditionParams["commentType"] = "before";
  private limit = 5;
  private languageModelId = "";
  private queryContent = "Tell me the best 10 selling products.";
  private generatedQueryText = "";
  private isEnLanguageUser = env.language === "en";
  private conName = "";
  private dbSchema: DbSchema | undefined;
  private selectedTableNames: string[] = [];
  private cachedDDLMap: Map<string, string> = new Map();
  private cachedSampleDataMap: Map<string, ResultSetData> = new Map();
  private screenMode: "setting" | "generating" | "generated" = "setting";

  protected constructor(panel: WebviewPanel, extensionUri: Uri) {
    super(panel, extensionUri);
  }

  public static revive(panel: WebviewPanel, extensionUri: Uri) {
    Chat2QueryPanel.currentPanel = new Chat2QueryPanel(panel, extensionUri);
  }

  static setStateStorage(storage: StateStorage) {
    Chat2QueryPanel.stateStorage = storage;
  }

  static setMainController(controller: MainController) {
    Chat2QueryPanel.controller = controller;
  }

  getComponentName(): ComponentName {
    return "Chat2QueryPanel";
  }

  protected async recieveMessageFromWebview(message: ActionCommand): Promise<void> {
    const { command, params } = message;
    switch (command) {
      case "cancel":
        this.dispose();
        return;
      case "execute":
        await this.execute();
        return;
      case "ok": {
        const myParams: Chat2QueryConditionParams = params;
        const { preview } = myParams;
        this.translateResponse = myParams.translateResponse;
        this.withTableDefinition = myParams.withTableDefinition;
        this.withSampleData = myParams.withSampleData;
        this.selectedTableNames = myParams.selectedTableNames;
        this.languageModelId = myParams.languageModelId;
        this.queryContent = myParams.queryContent;
        this.commentType = myParams.commentType;

        if (!this.dbSchema || !this.conName) {
          return;
        }

        if (preview) {
          const prompt = await this.createPrompt(false);
          if (!prompt) {
            return;
          }
          this.screenMode = "setting";
          // send to webview
          const msg: Chat2QueryPanelEventData = {
            command: "set-prompts",
            componentName: "Chat2QueryPanel",
            value: {
              setPrompts: {
                assistantPromptText: prompt.assistant,
                userPromptText: prompt.user,
              },
            },
          };
          this.panel.webview.postMessage(msg);
        } else {
          let explanation = "";
          let errorMessage = "";
          const prompt = await this.createPrompt(true);
          if (!prompt) {
            return;
          }

          let [model] = await lm.selectChatModels({ id: this.languageModelId });
          const messages = [
            LanguageModelChatMessage.Assistant(prompt.assistant),
            LanguageModelChatMessage.User(prompt.user),
          ];
          // make sure the model is available
          if (model) {
            let start = Date.now();
            // send the messages array to the model and get the response
            const cts = new CancellationTokenSource();
            let accumulatedResponse = "";

            try {
              let chatResponse = await model.sendRequest(messages, {}, cts.token);
              // handle chat response
              let counter = 0;
              for await (const fragment of chatResponse.text) {
                if (cts.token.isCancellationRequested) {
                  return;
                }
                accumulatedResponse += fragment;
                if (counter % 5 === 0) {
                  // send the message to the webview every 5 fragments
                  const elapsedTime = Date.now() - start;
                  // 正規表現で "explanation" の内容を抽出
                  const match = accumulatedResponse.match(/"explanation"\s*:\s*"([^"]*)"/);
                  if (match) {
                    explanation = match[1];
                  }
                  let queryText = "";
                  const idx = accumulatedResponse.indexOf('"query"');
                  if (idx !== -1) {
                    queryText = accumulatedResponse.substring(idx + 9);
                  }
                  const msg: Chat2QueryPanelEventData = {
                    command: "set-results",
                    componentName: "Chat2QueryPanel",
                    value: {
                      setResult: {
                        screenMode: "generating",
                        elapsedTime: `${(elapsedTime / 1000).toFixed(2)} sec`,
                        modelName: model.family,
                        explanation,
                        queryText,
                        errorMessage,
                      },
                    },
                  };
                  this.panel.webview.postMessage(msg);
                }
                counter++;
              }
              try {
                const res = JSON.parse(accumulatedResponse) as ResponseType;
                this.generatedQueryText = res.query;
                explanation = res.explanation;
              } catch (e) {
                // JSON.parse failed, try to extract the query text
                if (e instanceof Error) {
                  errorMessage = e.message;
                } else {
                  errorMessage = String(e);
                }
                errorMessage +=
                  "\nAn error occurred while parsing the JSON. The following content could not be parsed:\n";
                errorMessage += accumulatedResponse;
                logError(`${PREFIX} ${errorMessage}`);
              }
            } catch (e) {
              if (e instanceof Error) {
                errorMessage = e.message;
              } else {
                errorMessage = String(e);
              }
              logError(`${PREFIX} ${errorMessage}`);
            }

            const elapsedTime = Date.now() - start;
            // send to webview
            const msg: Chat2QueryPanelEventData = {
              command: "set-results",
              componentName: "Chat2QueryPanel",
              value: {
                setResult: {
                  screenMode: "generated",
                  elapsedTime: `${(elapsedTime / 1000).toFixed(2)} sec`,
                  modelName: model.family,
                  explanation,
                  queryText: this.generatedQueryText,
                  errorMessage,
                },
              },
            };
            this.panel.webview.postMessage(msg);
          } else {
            window.showErrorMessage("The language model was unavailable.");
          }
        }
      }
    }
  }

  private async execute() {
    if (!this.dbSchema || !this.conName) {
      return undefined;
    }

    const setting = await Chat2QueryPanel.stateStorage?.getConnectionSettingByName(this.conName);
    if (!setting) {
      return undefined;
    }
    const { ok, result, message } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
      setting,
      async (driver) => {
        log(`${PREFIX} query:` + this.generatedQueryText);
        return await driver.requestSql({ sql: this.generatedQueryText });
      }
    );

    if (ok && result) {
      const commandParam: MdhViewParams = { title: "Result", list: [result] };
      commands.executeCommand(OPEN_MDH_VIEWER, commandParam);
    } else {
      // show error message
      window.showErrorMessage(message);
    }
  }

  private async createPrompt(
    withJSONResponseFormartForEngine: boolean
  ): Promise<{ assistant: string; user: string } | undefined> {
    if (!this.dbSchema || !this.conName) {
      return undefined;
    }

    const setting = await Chat2QueryPanel.stateStorage?.getConnectionSettingByName(this.conName);
    if (!setting) {
      return undefined;
    }
    const dbProduct = Chat2QueryPanel.stateStorage?.getDBProductByConnectionName(this.conName);
    if (!dbProduct) {
      return undefined;
    }

    const { ok, result } = await DBDriverResolver.getInstance().workflow<RDSBaseDriver>(
      setting,
      async (driver) => {
        const isPositionedParameterAvailable = driver.isPositionedParameterAvailable();
        const toPositionalCharacter = driver.getPositionalCharacter();
        const isLimitAsTop = driver.isLimitAsTop();
        const isSchemaSpecificationSvailable = driver.isSchemaSpecificationSvailable();
        const sqlLang = driver.getSqlLang();

        for (const tableName of this.selectedTableNames) {
          const dbTable = this.dbSchema?.children.find((table) => table.name === tableName);
          const schemaName = this.dbSchema?.name;
          if (this.withTableDefinition && !this.cachedDDLMap.has(tableName)) {
            let ddl = "";
            if (driver.supportsShowCreate()) {
              ddl = await driver.getTableDDL({ schemaName, tableName });
            }
            if (!ddl) {
              if (dbTable) {
                ddl = toCreateTableDDL({ dbTable });
              }
            }
            if (ddl) {
              this.cachedDDLMap.set(tableName, ddl);
            }
          }
          if (this.withSampleData && !this.cachedSampleDataMap.has(tableName) && dbTable) {
            const { query, binds } = toViewDataNormalizedQuery({
              tableRes: dbTable,
              schemaName: isSchemaSpecificationSvailable ? schemaName : undefined,
              toPositionedParameter: isPositionedParameterAvailable,
              toPositionalCharacter: toPositionalCharacter,
              limitAsTop: isLimitAsTop,
              conditions: undefined,
              limit: this.limit,
              sqlLang,
            });
            const sampleData = await driver.requestSql({
              sql: query,
              conditions: { binds },
            });
            if (sampleData) {
              this.cachedSampleDataMap.set(tableName, sampleData);
            }
          }
        }
      }
    );

    if (ok && result) {
      return result;
    }

    const assistantContents: string[] = [];
    let tableDefinitionsContent: string = "";
    let sampleDataContent: string = "";
    for (const tableName of this.selectedTableNames) {
      if (this.withTableDefinition) {
        const ddl = this.cachedDDLMap.get(tableName);
        if (tableDefinitionsContent) {
          tableDefinitionsContent += "\n\n";
        }
        tableDefinitionsContent += ddl;
      }

      if (this.withSampleData) {
        const rdh = this.cachedSampleDataMap.get(tableName);
        if (!rdh) {
          continue;
        }
        if (sampleDataContent) {
          sampleDataContent += "\n\n";
        }
        sampleDataContent += "- Table: " + tableName + "\n\n";
        sampleDataContent += ResultSetDataBuilder.from(rdh).toMarkdown({ maxCellValueLength: 500 });
      }
    }
    assistantContents.push(ASSISTANT_ANNOTATION_PROMPT);

    if (this.withTableDefinition && tableDefinitionsContent) {
      assistantContents.push(
        `Use backticks only where required, based on the DDL — not for all identifiers.`
      );
    }

    switch (this.commentType) {
      case "none":
        assistantContents.push(`Only output the SQL query. No explanation needed.`);
        break;
      case "before":
        assistantContents.push(
          `Begin the output with a one-sentence explanation written as a SQL comment using (--), followed by the SQL query itself.`
        );
        break;
      case "inline":
        assistantContents.push(
          `Please use (--) to write inline comments at the end of each SQL line.`
        );
        assistantContents.push(`For example: SELECT * FROM orders -- select all orders.`);
        break;
    }

    if (withJSONResponseFormartForEngine) {
      assistantContents.push(`Do NOT use markdown, triple backticks, or code formatting.`);
      assistantContents.push("");
      assistantContents.push("Format the suggestions in stringified with JSON.stringify.");
      assistantContents.push("");
      assistantContents.push(
        "If there is no explanation, the response 'explanation' will be an empty string."
      );
      assistantContents.push("Here is an example of how the response should look:");
      assistantContents.push("");

      const exampleObj: ResponseType = {
        explanation:
          "This query identifies orders with missing or zero quantity items by checking for NULL or zero values in the `amount` column of the `order_detail` table.",
        query:
          "SELECT o.`order_no`\nFROM `order` o\nJOIN `order_detail` od ON o.`order_no` = od.`order_no`\nWHERE od.amount IS NULL OR od.`amount` = 0;",
      };

      switch (this.commentType) {
        case "none":
          exampleObj.explanation = "";
          break;
        case "before":
          exampleObj.explanation = "";
          exampleObj.query =
            "-- This query identifies orders with missing or zero quantity items by checking for NULL or zero values in the `amount` column of the `order_detail` table.\n\nSELECT o.`order_no`\nFROM `order` o\nJOIN `order_detail` od ON o.`order_no` = od.`order_no`\nWHERE od.amount IS NULL OR od.`amount` = 0;";
          break;
        case "inline":
          exampleObj.query =
            "SELECT\ncustomer_id,  -- Selecting the customer ID\nSUM(total_amount) AS total_spent  -- Calculating total amount spent by each customer\nFROM orders\nGROUP BY customer_id  -- Grouping by customer to get totals per customer\nORDER BY total_spent DESC  -- Sorting from highest to lowest spender\nLIMIT 5;  -- Limiting to top 5 customers";
          break;
      }

      assistantContents.push(JSON.stringify(exampleObj));
    }

    //-------------------------------------
    // USER
    const userContents: string[] = [];

    const userContentsDetails: string[] = [];

    userContents.push(`Create query with the following information.`);
    userContents.push(`Target database is “${dbProduct}”.`);

    userContentsDetails.push("# Query Content");
    userContentsDetails.push("");
    userContentsDetails.push("```text");
    userContentsDetails.push(this.queryContent);
    userContentsDetails.push("```");
    userContentsDetails.push("");

    if (this.withTableDefinition && tableDefinitionsContent) {
      userContents.push(
        'Related "Table definitions" are also shared so that you can use them to create queries as needed.'
      );
      userContentsDetails.push("");
      userContentsDetails.push(`# Table definitions`);
      userContentsDetails.push("");
      userContentsDetails.push("```sql");
      userContentsDetails.push(tableDefinitionsContent);
      userContentsDetails.push("```");
    }

    if (this.withSampleData && sampleDataContent) {
      userContents.push(
        'Related "Sample data" are also shared so that you can use them to create queries as needed.'
      );
      userContentsDetails.push("");
      userContentsDetails.push(`# Sample data`);
      userContentsDetails.push("");
      userContentsDetails.push("```markdown");
      userContentsDetails.push(sampleDataContent);
      userContentsDetails.push("```");
    }

    if (this.translateResponse) {
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
  }

  protected preDispose(): void {
    Chat2QueryPanel.currentPanel = undefined;
  }

  public static render(extensionUri: Uri, conName: string, schemaRes: DbSchema) {
    if (Chat2QueryPanel.currentPanel) {
      Chat2QueryPanel.currentPanel.getWebviewPanel().reveal(ViewColumn.One);
    } else {
      // If a webview panel does not already exist create and show a new one
      const panel = window.createWebviewPanel(
        "Chat2QueryPanel",
        "Chat2QueryPanel",
        ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            Uri.joinPath(extensionUri, "out"),
            Uri.joinPath(extensionUri, "webview-ui/build"),
          ],
        }
      );
      Chat2QueryPanel.currentPanel = new Chat2QueryPanel(panel, extensionUri);
    }
    Chat2QueryPanel.currentPanel.conName = conName;
    Chat2QueryPanel.currentPanel.dbSchema = schemaRes;
    Chat2QueryPanel.currentPanel.renderSub();
  }

  async renderSub() {
    let errorMessage = "";
    if (!this.dbSchema || !this.conName) {
      return;
    }

    const models = await lm.selectChatModels({
      vendor: "copilot",
    });
    let languageModels: { label: string; value: string }[] = [];
    if (models.length === 0) {
      errorMessage =
        "No models found. Please check your network connection and ensure Copilot is set up properly before trying again.";
      window.showErrorMessage(errorMessage);
    } else {
      languageModels = models.map((model) => ({
        label: model.name ? model.name : `${model.vendor} (${model.family})`,
        value: model.id,
      }));

      this.languageModelId = languageModels[0].value;
      const gpt4oModel = models.find((model) => model.family.toLocaleLowerCase() === "gpt-4o");
      if (gpt4oModel) {
        this.languageModelId = gpt4oModel.id;
      }
      this.translateResponse = this.isEnLanguageUser ? false : true;
      this.withTableDefinition = false;
      this.withSampleData = false;
    }

    const prompt = await this.createPrompt(false);
    if (!prompt) {
      return;
    }

    const msg: Chat2QueryPanelEventData = {
      command: "initialize",
      componentName: "Chat2QueryPanel",
      value: {
        initialize: {
          errorMessage,
          allTables: this.dbSchema?.children ?? [],
          selectedTableNames: [],
          languageModels,
          languageModelId: this.languageModelId,
          assistantPromptText: prompt.assistant,
          userPromptText: prompt.user,
          queryContent: this.queryContent,
          translateResponse: this.translateResponse,
          withTableDefinition: this.withTableDefinition,
          withSampleData: this.withSampleData,
          screenMode: this.screenMode,
        },
      },
    };

    this.panel.webview.postMessage(msg);
  }
}
