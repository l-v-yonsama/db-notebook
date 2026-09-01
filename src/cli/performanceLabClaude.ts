import { promises as fs } from "fs";
import path from "path";
import execa from "execa";
import type { PerformanceTuningContext } from "@l-v-yonsama/multi-platform-database-drivers";
import { buildPlainTextAnalysisPrompt } from "../performanceTuning/ai/performanceTuningAiPrompt";

// Personal performance-lab helper. Intentionally small: it receives an
// already-collected Full Context JSON, sends the same db-notebook prompt to
// Claude Code, then writes two inspectable artifacts. It neither connects to
// a database nor starts VS Code; db-drivers remains responsible for context
// collection.

type CliArgs = {
  context?: string;
  input?: string;
  output?: string;
  model?: string;
};

type RawDbnCell = {
  kind: 1 | 2;
  language: string;
  value: string;
  metadata: Record<string, string>;
  outputs: unknown[];
};

function usage(): string {
  return [
    "Usage:",
    "  npm run performance-lab:claude -- --context /path/full-context.json --output /path/aiResults/oracle [--model sonnet]",
    "  npm run performance-lab:claude -- --input /path/aiInputs --output /path/aiOutputs [--model sonnet]",
    "",
    "--input recursively reads *.full-context.json and preserves its vendor subdirectories below --output.",
    "Writes <context-name>-<model>.md and .dbn. Claude Code must already be authenticated.",
  ].join("\n");
}

function parseArgs(args: string[]): CliArgs {
  const parsed: CliArgs = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--context") {
      parsed.context = args[++i];
    } else if (key === "--input") {
      parsed.input = args[++i];
    } else if (key === "--output") {
      parsed.output = args[++i];
    } else if (key === "--model") {
      parsed.model = args[++i];
    } else if (key === "--help" || key === "-h") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${key}\n\n${usage()}`);
    }
  }
  if (!parsed.output || (!parsed.context && !parsed.input) || (parsed.context && parsed.input)) {
    throw new Error(`Specify exactly one of --context or --input, and --output.\n\n${usage()}`);
  }
  return parsed;
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "") || "claude";
}

function contextName(filePath: string): string {
  const name = path.basename(filePath);
  return name.replace(/(?:\.full-context|\.context)?\.json$/i, "") || "performance-tuning";
}

async function findContextFiles(inputPath: string): Promise<string[]> {
  const stat = await fs.stat(inputPath);
  if (stat.isFile()) {
    return [inputPath];
  }
  if (!stat.isDirectory()) {
    throw new Error(`--input must be a file or directory: ${inputPath}`);
  }

  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".full-context.json")) {
        files.push(entryPath);
      }
    }
  };
  await visit(inputPath);
  if (files.length === 0) {
    throw new Error(`No *.full-context.json files found below: ${inputPath}`);
  }
  return files;
}

function markdownArtifact(
  context: PerformanceTuningContext,
  model: string,
  sourcePath: string,
  analysis: string,
): string {
  return [
    "# Performance Tuning AI Analysis",
    "",
    `- Database: ${context.database.vendor} / ${context.database.databaseName}`,
    `- Model: ${model}`,
    `- Context: ${sourcePath}`,
    `- Generated at: ${new Date().toISOString()}`,
    "",
    analysis.trim(),
    "",
  ].join("\n");
}

function dbnArtifact(
  context: PerformanceTuningContext,
  model: string,
  prompt: string,
  analysis: string,
): string {
  const overview = [
    "# Performance Tuning AI Analysis",
    "",
    `| Item | Detail |`,
    `|---|---|`,
    `| Database | ${context.database.vendor}${context.database.version ? ` ${context.database.version}` : ""} / ${context.database.databaseName} |`,
    `| Model | ${model} (Claude CLI) |`,
    `| Generated at | ${new Date().toISOString()} |`,
    "",
    "## Target SQL",
    "",
    "```sql",
    context.statement.sql,
    "```",
  ].join("\n");
  const cells: RawDbnCell[] = [
    { kind: 1, language: "markdown", value: overview, metadata: {}, outputs: [] },
    { kind: 1, language: "markdown", value: `## AI analysis\n\n${analysis.trim()}`, metadata: {}, outputs: [] },
    {
      kind: 2,
      language: "json",
      value: JSON.stringify(context, null, 2),
      metadata: { cellLabel: "Full context JSON" },
      outputs: [],
    },
    {
      kind: 2,
      language: "markdown",
      value: prompt,
      metadata: { cellLabel: "Claude prompt" },
      outputs: [],
    },
  ];
  return JSON.stringify({ cells, metadata: {} }, null, 1);
}

async function analyzeContext(
  contextPath: string,
  outputDirectory: string,
  modelArgument: string | undefined,
): Promise<void> {
  const contextText = await fs.readFile(contextPath, "utf8");
  const context = JSON.parse(contextText) as PerformanceTuningContext;
  const model = modelArgument ?? "claude";
  const prompt = buildPlainTextAnalysisPrompt(context);

  console.log(`Running Claude for ${context.database.vendor}/${contextName(contextPath)}...`);
  const claudeArgs = ["-p"];
  if (modelArgument) {
    claudeArgs.push("--model", modelArgument);
  }
  const result = await execa("claude", claudeArgs, { input: prompt });
  const analysis = result.stdout.trim();
  if (!analysis) {
    throw new Error("Claude returned no text.");
  }

  await fs.mkdir(outputDirectory, { recursive: true });
  const stem = `${contextName(contextPath)}-${safeFilePart(model)}`;
  const markdownPath = path.join(outputDirectory, `${stem}.md`);
  const dbnPath = path.join(outputDirectory, `${stem}.dbn`);
  await Promise.all([
    fs.writeFile(markdownPath, markdownArtifact(context, model, contextPath, analysis), "utf8"),
    fs.writeFile(dbnPath, dbnArtifact(context, model, prompt, analysis), "utf8"),
  ]);
  console.log(`Wrote ${markdownPath}`);
  console.log(`Wrote ${dbnPath}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.context) {
    await analyzeContext(args.context, args.output!, args.model);
    return;
  }

  const inputRoot = path.resolve(args.input!);
  const contexts = await findContextFiles(inputRoot);
  console.log(`Found ${contexts.length} Full Context JSON file(s).`);
  // Claude CLI processes are intentionally sequential: this avoids losing a
  // long-running evaluation to account-side concurrency/rate limits, while
  // making every source artifact and generated result easy to correlate.
  for (const contextPath of contexts) {
    const relativeDirectory = path.dirname(path.relative(inputRoot, contextPath));
    const outputDirectory = relativeDirectory === "."
      ? args.output!
      : path.join(args.output!, relativeDirectory);
    await analyzeContext(contextPath, outputDirectory, args.model);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
