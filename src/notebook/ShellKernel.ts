import * as cp from "child_process";
import * as iconv from "iconv-lite";
import * as os from "os";
import * as path from "path";
import { NotebookCell, workspace } from "vscode";
import { ShellConfigType } from "../types/Config";
import { EMOJI } from "../types/Emoji";
import { RunResult } from "../types/Notebook";
import { getShellConfig } from "../utilities/configUtil";
import {
  createDirectoryOnTmpStorage,
  deleteDirsOnStorage,
  writeToResourceOnStorage,
} from "../utilities/fsUtil";
import { log } from "../utilities/logger";

const PREFIX = "  [notebook/ShellKernel]";

export type ShellLanguageId = "shellscript" | "bat";

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

export class ShellKernel {
  private child: cp.ChildProcess | undefined;

  private constructor(private tmpDirectory: string) {}

  static async create(): Promise<ShellKernel> {
    const tmpDir = await createDirectoryOnTmpStorage(`shell_${new Date().getTime()}`);
    return new ShellKernel(tmpDir);
  }

  public async run(cell: NotebookCell): Promise<RunResult> {
    const languageId = cell.document.languageId as ShellLanguageId;
    const scriptFile = path.join(this.tmpDirectory, `script.${languageId === "bat" ? "bat" : "sh"}`);
    await writeToResourceOnStorage(scriptFile, cell.document.getText());

    const config = getShellConfig();
    const { command, args } = resolveShellCommand(languageId, scriptFile, config);
    const { dataEncoding } = config;

    let stdout = "";
    let stderr = "";

    try {
      const rootUri = workspace.workspaceFolders?.[0].uri;
      const options: cp.SpawnOptions = {
        // Make the spawned shell the leader of its own process group (POSIX)
        // so interrupt() can kill it *and* any processes it forks (e.g. a
        // `sleep` command run from the script) -- killing only the shell's
        // own pid leaves such grandchild processes running.
        detached: true,
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
        metadata: {},
      };
    } catch (err) {
      const isBat = languageId === "bat";
      const settingName = isBat ? "shell.Windows shell path" : "shell.Shell path";
      const errorMessages = ["Error while trying to spawn a child process."];
      if (err instanceof Error) {
        errorMessages.push(err.message);
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
        metadata: {},
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
