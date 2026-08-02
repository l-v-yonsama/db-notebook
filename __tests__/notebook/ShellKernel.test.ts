import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NotebookCell } from "vscode";
import { resolveShellCommand, ShellKernel } from "../../src/notebook/ShellKernel";
import { initializeStorageTmpPath } from "../../src/utilities/fsUtil";

let scratchRoot: string;

beforeAll(async () => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ShellKernel-test-"));
  await initializeStorageTmpPath(scratchRoot);
});

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

const makeCell = (
  text: string,
  languageId: "shellscript" | "bat" = "shellscript"
): NotebookCell =>
  ({
    document: {
      languageId,
      getText: () => text,
    },
  } as unknown as NotebookCell);

describe("ShellKernel / shellscript (real bash spawn)", () => {
  it("echoで標準出力を取得し、status=executedになる", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell("echo hello"));

    expect(result.stdout).toContain("hello");
    expect(result.status).toBe("executed");
  }, 15000);

  it("exit 1で終了するとstatus=errorになる", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell("exit 1"));

    expect(result.status).toBe("error");
  }, 15000);

  it("stderrに書き込んでもexit 0ならstatus=executedになる(exit code優先の設計)", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell("echo warn 1>&2; exit 0"));

    expect(result.stderr).toContain("warn");
    expect(result.status).toBe("executed");
  }, 15000);

  it("interrupt()はシェルが起動した孫プロセス(sleep等)も含めて即座に停止する", async () => {
    const kernel = await ShellKernel.create();
    const runPromise = kernel.run(makeCell("sleep 5; echo done"));

    // sleepが実際にforkされるまで少し待ってからinterruptする
    // (先にkillすると、そもそも孫プロセスが存在しない状態でテストが「たまたま」通ってしまう)
    await new Promise((resolve) => setTimeout(resolve, 300));
    const start = Date.now();
    kernel.interrupt();

    const result = await runPromise;
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(3000);
    expect(result.status).toBe("error");
  }, 15000);
});

describe("resolveShellCommand (pure logic, no spawning -- covers bat on any OS)", () => {
  it("shellscript: shellPath未設定ならbashにfallbackする", () => {
    const { command, args } = resolveShellCommand("shellscript", "/tmp/script.sh", {
      shellPath: "",
      windowsShellPath: "",
      dataEncoding: "",
    });
    expect(command).toBe("bash");
    expect(args).toEqual(["/tmp/script.sh"]);
  });

  it("shellscript: shellPathが設定されていればそれを使う", () => {
    const { command } = resolveShellCommand("shellscript", "/tmp/script.sh", {
      shellPath: "/usr/local/bin/zsh",
      windowsShellPath: "",
      dataEncoding: "",
    });
    expect(command).toBe("/usr/local/bin/zsh");
  });

  it("bat: windowsShellPath未設定ならcmd.exeに/cフラグ付きでfallbackする", () => {
    const { command, args } = resolveShellCommand("bat", "C:\\tmp\\script.bat", {
      shellPath: "",
      windowsShellPath: "",
      dataEncoding: "",
    });
    expect(command).toBe("cmd.exe");
    expect(args).toEqual(["/c", "C:\\tmp\\script.bat"]);
  });

  it("bat: windowsShellPathが設定されていればそれを使う", () => {
    const { command } = resolveShellCommand("bat", "C:\\tmp\\script.bat", {
      shellPath: "",
      windowsShellPath: "C:\\Windows\\System32\\cmd.exe",
      dataEncoding: "",
    });
    expect(command).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});
