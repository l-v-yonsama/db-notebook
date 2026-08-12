import * as cp from "child_process";
import * as iconv from "iconv-lite";
import * as os from "os";
import * as path from "path";
import { NotebookCell, workspace } from "vscode";
import { ShellConfigType } from "../types/Config";
import { EMOJI } from "../types/Emoji";
import { NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { getShellConfig } from "../utilities/configUtil";
import {
  createDirectoryOnTmpStorage,
  deleteDirsOnStorage,
  writeToResourceOnStorage,
} from "../utilities/fsUtil";
import { log } from "../utilities/logger";

const PREFIX = "  [notebook/ShellKernel]";

export type ShellLanguageId = "shellscript" | "bat";

const SHARED_VARIABLE_ENV_PREFIX = "DB_NOTEBOOK_VAR_";
const SHELL_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Pure, synchronous decision of which interpreter binary + args to spawn for
 * a given cell language. No process spawning here -- kept side-effect free
 * so the "bat" branch (not runnable end-to-end on this non-Windows machine)
 * can still be unit-tested for correctness.
 */
export function resolveShellCommand(
  languageId: ShellLanguageId,
  scriptFile: string,
  config: ShellConfigType
): { command: string; args: string[] } {
  if (languageId === "bat") {
    return {
      command: config.windowsShellPath || "cmd.exe",
      args: ["/c", scriptFile],
    };
  }
  return {
    command: config.shellPath || "bash",
    args: [scriptFile],
  };
}

/**
 * Converts a single shared-variable value into the string form exposed as a
 * shell environment variable. Strings/numbers/booleans/null are kept as
 * plain, unquoted text so beginners can use them without JSON parsing;
 * arrays/objects fall back to JSON so nothing is silently lossy.
 */
export function serializeShellVariable(name: string, value: unknown): string {
  if (typeof value === "string") {
    if (value.includes("\0")) {
      throw new Error(`Shared variable "${name}" contains a NUL character and cannot be exposed to a shell process.`);
    }
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    throw new Error(
      `Shared variable "${name}" has a value of type "${typeof value}" and cannot be exposed to a shell process.`
    );
  }

  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new Error("JSON.stringify() returned undefined.");
    }
    return serialized;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    throw new Error(`Shared variable "${name}" could not be serialized to JSON (${reason}).`);
  }
}

/**
 * Builds the environment to pass to a spawned shell/bat process: the base
 * environment (normally `process.env`, so PATH/HOME etc. are preserved) plus
 * every notebook shared variable exposed as `DB_NOTEBOOK_VAR_<name>`.
 *
 * Names starting with "_" (e.g. `_skipSql`) are internal bookkeeping used
 * between notebook kernels, not values a user created -- they are skipped so
 * they do not show up as unexplained shell variables.
 *
 * Shared-variable names must be usable as shell variable names as-is
 * (`^[A-Za-z_][A-Za-z0-9_]*$`); invalid names throw rather than being
 * silently normalized, since e.g. `user-name` and `user_name` could then
 * collide.
 */
export function buildShellEnvironment(
  variables: NotebookExecutionVariables,
  baseEnvironment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnvironment };

  for (const [name, value] of Object.entries(variables)) {
    if (name.startsWith("_")) {
      continue;
    }
    if (!SHELL_VARIABLE_NAME_PATTERN.test(name)) {
      throw new Error(
        `Shared variable name "${name}" cannot be used as a shell variable. ` +
          `Use letters, numbers, and underscores, and do not start the name with a number.`
      );
    }
    env[`${SHARED_VARIABLE_ENV_PREFIX}${name}`] = serializeShellVariable(name, value);
  }

  return env;
}

export class ShellKernel {
  private child: cp.ChildProcess | undefined;

  private constructor(private tmpDirectory: string) {}

  static async create(): Promise<ShellKernel> {
    const tmpDir = await createDirectoryOnTmpStorage(`shell_${new Date().getTime()}`);
    return new ShellKernel(tmpDir);
  }

  public async run(
    cell: NotebookCell,
    variables: NotebookExecutionVariables = {}
  ): Promise<RunResult> {
    const languageId = cell.document.languageId as ShellLanguageId;
    const scriptFile = path.join(this.tmpDirectory, `script.${languageId === "bat" ? "bat" : "sh"}`);
    await writeToResourceOnStorage(scriptFile, cell.document.getText());

    const config = getShellConfig();
    const { command, args } = resolveShellCommand(languageId, scriptFile, config);
    const { dataEncoding } = config;

    let stdout = "";
    let stderr = "";
    const startTime = new Date().getTime();

    try {
      // Validate/serialize shared variables before spawning anything, so an
      // invalid name or value is reported as a clear validation error rather
      // than being funneled into the "check your shell path" message below.
      let shellEnvironment: NodeJS.ProcessEnv;
      try {
        shellEnvironment = buildShellEnvironment(variables);
      } catch (err) {
        return {
          stdout: "",
          stderr: err instanceof Error ? err.message : String(err),
          skipped: false,
          status: "error",
          metadata: {
            shellResult: {
              ok: false,
              message: err instanceof Error ? err.message : undefined,
              elapsedTime: new Date().getTime() - startTime,
            },
          },
        };
      }

      const rootUri = workspace.workspaceFolders?.[0].uri;
      const options: cp.SpawnOptions = {
        // Make the spawned shell the leader of its own process group (POSIX)
        // so interrupt() can kill it *and* any processes it forks (e.g. a
        // `sleep` command run from the script) -- killing only the shell's
        // own pid leaves such grandchild processes running.
        detached: true,
        env: shellEnvironment,
      };
      if (rootUri) {
        options.cwd = rootUri.fsPath;
      }

      this.child = cp.spawn(command, args, options);

      const code = await new Promise<number | null>((resolve, reject) => {
        if (!this.child) {
          reject(new Error("Failed to spawn child process"));
          return;
        }
        this.child.stdout?.on("data", (data: Buffer) => {
          stdout += dataEncoding ? iconv.decode(data, dataEncoding) : data.toString();
        });
        this.child.stderr?.on("data", (data: Buffer) => {
          stderr += dataEncoding ? iconv.decode(data, dataEncoding) : data.toString();
        });
        this.child.on("error", reject);
        this.child.on("close", (code) => resolve(code));
      });

      this.child = undefined;

      return {
        stdout,
        stderr,
        skipped: false,
        status: code === 0 ? "executed" : "error",
        metadata: {
          shellResult: {
            ok: code === 0,
            elapsedTime: new Date().getTime() - startTime,
          },
        },
      };
    } catch (err) {
      const isBat = languageId === "bat";
      const settingName = isBat ? "shell.Windows shell path" : "shell.Shell path";
      const errorMessages = ["Error while trying to spawn a child process."];
      if (err instanceof Error) {
        errorMessages.push(err.message);
      }
      const errCode = (err as NodeJS.ErrnoException)?.code;
      if (errCode === "E2BIG" || errCode === "ENAMETOOLONG") {
        errorMessages.push(
          `${EMOJI.warning} The shell process could not be started because the shared-variable environment may be too large.`
        );
        errorMessages.push(
          `${EMOJI.information} Reduce the size of arrays, objects, or saved execution results held in shared variables.`
        );
      }
      errorMessages.push(
        `${EMOJI.warning} Set or verify the path to the ${
          isBat ? "Windows shell (cmd.exe)" : "shell (bash)"
        } executable used to run this cell.`
      );
      errorMessages.push(`${EMOJI.information} Go to File or Code > Preferences > Settings.`);
      errorMessages.push(`${EMOJI.information} Enter the key word "${settingName}" in the Search bar.`);
      return {
        stdout,
        stderr: errorMessages.join(os.EOL),
        skipped: false,
        status: "error",
        metadata: {
          shellResult: {
            ok: false,
            message: err instanceof Error ? err.message : undefined,
            elapsedTime: new Date().getTime() - startTime,
          },
        },
      };
    } finally {
      // ShellKernel is created-run-discarded per cell (like MemcachedKernel),
      // not session-scoped like NodeKernel, so there is no external dispose()
      // call to rely on -- clean up the tmp directory here instead.
      await deleteDirsOnStorage(this.tmpDirectory);
    }
  }

  interrupt() {
    if (this.child && this.child.pid !== undefined) {
      log(`${PREFIX} [interrupt] kill pid:${this.child.pid}`);
      try {
        if (process.platform === "win32") {
          process.kill(this.child.pid);
        } else {
          // Negative pid targets the whole process group (see the `detached:
          // true` spawn option above), reaching grandchild processes too.
          process.kill(-this.child.pid, "SIGTERM");
        }
      } catch (e) {
        log(`${PREFIX} [interrupt] Error:${e instanceof Error ? e.message : e}`);
      }
      this.child = undefined;
    } else {
      log(`${PREFIX} No interrupt target`);
    }
  }
}
