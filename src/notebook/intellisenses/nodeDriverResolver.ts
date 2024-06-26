import { CompletionItem, CompletionItemKind, SnippetString } from "vscode";
import { createDocumentation } from "../intellisense";

export const setNodeDriverResolverCompletionItems = (
  list: CompletionItem[],
  conNamesString: string
): void => {
  appendCompletionItem({
    list,
    label: "workflow",
    conNamesString,
    bodyScript: "  // return await driver.xxx;\n",
    detail: "Execute workflow",
    docString: DOCUMENT_OF_WORKFLOW,
  });

  appendCompletionItem({
    list,
    label: "viewData",
    conNamesString,
    bodyScript: "  return await driver.viewData('${2}'); -- tableName \n",
    detail: "Get table records",
    docString: DOCUMENT_OF_VIEW_DATA,
  });

  appendCompletionItem({
    list,
    label: "request transactional sql with binds",
    conNamesString,
    bodyScript:
      "  const { query, binds } = normalizeQuery({\n" +
      "    query: 'INSERT INTO test_table (id, title) VALUES (:id, :title)',\n" +
      "    bindParams: { id: 1, title: 'hello' },\n" +
      "    toPositionedParameter: driver.isPositionedParameterAvailable(),\n" +
      "    toPositionalCharacter: driver.getPositionalCharacter(),\n" +
      "  });\n" +
      "  return await driver.requestSql({ sql: query, conditions: { binds } });\n",
    detail: "Execute flowTransaction",
    docString: DOCUMENT_OF_WORKFLOW,
    resultAsRdh: true,
    flowTransaction: true,
  });

  appendCompletionItem({
    list,
    label: "scanLogGroup",
    conNamesString,
    bodyScript:
      "  const now = new Date();\n" +
      "  const startTime = now.getTime() - 1 * 60 * 60 * 1000;\n" +
      "  const endTime = now.getTime();\n" +
      "\n" +
      "  const logService = driver.getClientByServiceType('Cloudwatch');\n" +
      "  return await logService.scanLogGroup({\n" +
      "    target: 'test',\n" +
      "    keyword: 'ERROR',\n" +
      "    startTime,\n" +
      "    endTime,\n" +
      "    limit: 1000,\n" +
      "  });",
    detail: "Search log-records in log-group",
    docString: DOCUMENT_OF_SCAN_LOG_GROUP,
  });

  appendCompletionItem({
    list,
    label: "createQueue",
    conNamesString,
    bodyScript:
      "  return await driver.sqsClient.createQueue({ \n" +
      '    name: "${2}", \n' +
      "    attributes: { \n" +
      "      MaximumMessageSize: 500, \n" +
      "      ReceiveMessageWaitTimeSeconds: 2, \n" +
      "      VisibilityTimeout: 1, \n" +
      "      FifoQueue: true, \n" +
      "      ContentBasedDeduplication: true \n" +
      "    } \n" +
      "  });",
    detail: "Create sqs queue",
    docString: DOCUMENT_OF_CREATE_QUEUE,
  });

  appendCompletionItem({
    list,
    label: "sendMessage",
    conNamesString,
    bodyScript:
      "  return await driver.sqsClient.send({ \n" +
      '    QueueUrl: "${2}", \n' +
      "    MessageBody: 'Hello world', \n" +
      "    // MessageGroupId: 'HelloWorldGroup1', \n" +
      "    // MessageDeduplicationId: '123' \n" +
      "  });",
    detail: "Send message to sqs queue",
    docString: DOCUMENT_OF_SEND_MESSAGE,
  });

  appendCompletionItem({
    list,
    label: "scanMessages",
    conNamesString,
    bodyScript:
      "  return await driver.sqsClient.scan({ \n" +
      '    target: "${2}", // queue url \n' +
      "    limit: 100 \n" +
      "  });",
    detail: "Scan messages from sqs queue",
    docString: DOCUMENT_OF_SCAN_MESSAGE,
    resultAsRdh: true,
  });

  // SES
  appendCompletionItem({
    list,
    label: "verifyEmailAddress",
    conNamesString,
    bodyScript: '  await driver.sesClient.verifyEmailAddress("${2}");',
    detail: "Verify Email Address",
    docString: DOCUMENT_OF_VERIFY_EMAIL_ADDRESS,
  });

  appendCompletionItem({
    list,
    label: "verifyDomainIdentity",
    conNamesString,
    bodyScript: '  await driver.sesClient.verifyDomainIdentity("${2}");',
    detail: "Verify Domain",
    docString: DOCUMENT_OF_VERIFY_DOMAIN,
  });

  appendCompletionItem({
    list,
    label: "listIdentities",
    conNamesString,
    bodyScript: '  await driver.sesClient.listIdentities("${2|Domain,EmailAddress|}");',
    detail: "List Identities",
    docString: DOCUMENT_OF_LIST_ID,
  });
};

function appendCompletionItem({
  list,
  label,
  conNamesString,
  bodyScript,
  detail,
  docString,
  resultAsRdh,
  flowTransaction,
}: {
  list: CompletionItem[];
  label: string;
  conNamesString: string;
  bodyScript: string;
  detail: string;
  docString: string;
  resultAsRdh?: boolean;
  flowTransaction?: boolean;
}) {
  const description = "DBDriverResolver";
  let item = new CompletionItem({ label, description });
  const example =
    "const { ok, message, result } = await DBDriverResolver\n" +
    ".getInstance()\n" +
    `${flowTransaction === true ? ".flowTransaction" : ".workflow"}` +
    "(getConnectionSettingByName('${1|" +
    conNamesString +
    "|}'), async (driver) => {\n" +
    bodyScript +
    `\n}${flowTransaction ? ", { transactionControlType: 'rollbackOnError' }" : ""});\n` +
    "console.log('ok', ok);\n" +
    "console.log('message', message);\n" +
    (resultAsRdh === true
      ? "if (ok && result) {\n  writeResultSetData('title', result);\n}"
      : "console.log('result', JSON.stringify(result, null, 1));");
  item.insertText = new SnippetString(example);
  item.kind = CompletionItemKind.Function;
  item.detail = detail;
  item.documentation = createDocumentation({ example, spec: docString, ext: "typescript" });
  list.push(item);

  item = new CompletionItem({ label: `${description}.${label}`, description });
  item.insertText = new SnippetString(example);
  item.kind = CompletionItemKind.Function;
  item.detail = detail;
  item.documentation = createDocumentation({ example, spec: docString, ext: "typescript" });
  list.push(item);

  item = new CompletionItem({ label: `driver.${label}`, description });
  item.insertText = new SnippetString(example);
  item.kind = CompletionItemKind.Function;
  item.detail = detail;
  item.documentation = createDocumentation({ example, spec: docString, ext: "typescript" });
  list.push(item);
}

const DOCUMENT_OF_WORKFLOW = `interface workflow<T extends BaseDriver, U = any>(setting: ConnectionSetting, f: (driver: T) => Promise<U>): Promise<GeneralResult<U>>;`;

const DOCUMENT_OF_VIEW_DATA = `interface ... in workflow.
viewData(tableName: string, options?: {
  schemaName?: string;
  columnNames?: string[];
  maxRows?: number;
  compareKeys?: CompareKey[];
}): Promise<ResultSetDataHolder>;
`;

const DOCUMENT_OF_SCAN_LOG_GROUP = `interface ... in workflow.
scanLogGroup(params: {
    target: string;
    parentTarget?: string;
    limit: number;
    withValue?: boolean | 'auto';
    keyword?: string;
    startTime?: number;
    endTime?: number;
    targetResourceType?: ResourceType;
}): Promise<ResultSetDataHolder>;
`;

const DOCUMENT_OF_CREATE_QUEUE = `interface ... in workflow.
createQueue({ name, attributes }: {
  name: string;
  attributes?: {
    DelaySeconds?: number;
    MaximumMessageSize?: number;
    MessageRetentionPeriod?: number;
    Policy?: any;
    ReceiveMessageWaitTimeSeconds?: number;
    VisibilityTimeout?: number;
    RedrivePolicy?: any;
    RedriveAllowPolicy?: any;
    ContentBasedDeduplication?: boolean;
    DeduplicationScope?: any;
    FifoThroughputLimit?: any;
    FifoQueue?: boolean;
    ApproximateNumberOfMessages?: number;
    ApproximateNumberOfMessagesNotVisible?: number;
    ApproximateNumberOfMessagesDelayed?: number;
    CreatedTimestamp?: number;
    LastModifiedTimestamp?: number;
    [key: string]: any;
  }
}): Promise<string>;
`;

const DOCUMENT_OF_SEND_MESSAGE = `interface ... in workflow.
send({ input }: {
  input: {
    QueueUrl: string | undefined;
    MessageBody: string | undefined;
    DelaySeconds?: number;
    MessageAttributes?: Record<string, MessageAttributeValue>;
    MessageSystemAttributes?: Record<string, MessageSystemAttributeValue>;
    MessageDeduplicationId?: string;
    MessageGroupId?: string;
  }
}): Promise<{
  MD5OfMessageBody?: string;
  MD5OfMessageAttributes?: string;
  MD5OfMessageSystemAttributes?: string;
  MessageId?: string;
  SequenceNumber?: string;
}>;
`;

const DOCUMENT_OF_SCAN_MESSAGE = `interface ... in workflow.
scan(params: {
  target: string;
  parentTarget?: string;
  limit: number;
  withValue?: boolean | 'auto';
  keyword?: string;
  startTime?: number;
  endTime?: number;
  targetResourceType?: ResourceType;
}): Promise<ResultSetData>
`;

const DOCUMENT_OF_VERIFY_EMAIL_ADDRESS = `interface ... in workflow.
verifyEmailAddress(emailAddress: string): Promise<void>;
`;

const DOCUMENT_OF_VERIFY_DOMAIN = `interface ... in workflow.
verifyDomainIdentity(domain: string): Promise<void>;
`;

const DOCUMENT_OF_LIST_ID = `interface ... in workflow.
listIdentities(identityType: IdentityType): Promise<string[]>;
`;
