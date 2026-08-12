import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NotebookCell } from "vscode";
import {
  buildShellEnvironment,
  resolveShellCommand,
  serializeShellVariable,
  ShellKernel,
} from "../../src/notebook/ShellKernel";
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
    expect(result.metadata?.shellResult?.ok).toBe(true);
    expect(result.metadata?.shellResult?.elapsedTime).toBeGreaterThanOrEqual(0);
  }, 15000);

  it("exit 1で終了するとstatus=errorになる", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell("exit 1"));

    expect(result.status).toBe("error");
    expect(result.metadata?.shellResult?.ok).toBe(false);
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

describe("serializeShellVariable (pure logic)", () => {
  it("文字列はそのまま(引用符なし)で返す", () => {
    expect(serializeShellVariable("environment", "staging")).toBe("staging");
  });

  it("数値は文字列化される", () => {
    expect(serializeShellVariable("retryCount", 3)).toBe("3");
  });

  it("booleanはtrue/falseの文字列になる", () => {
    expect(serializeShellVariable("dryRun", true)).toBe("true");
    expect(serializeShellVariable("dryRun", false)).toBe("false");
  });

  it("nullは文字列\"null\"になる", () => {
    expect(serializeShellVariable("v", null)).toBe("null");
  });

  it("配列はJSON文字列になる", () => {
    expect(serializeShellVariable("ids", [10, 20, 30])).toBe("[10,20,30]");
  });

  it("オブジェクトはJSON文字列になる", () => {
    expect(serializeShellVariable("options", { output: "result.csv" })).toBe(
      '{"output":"result.csv"}'
    );
  });

  it("空文字列はそのまま保持される", () => {
    expect(serializeShellVariable("v", "")).toBe("");
  });

  it("改行を含む文字列はそのまま保持される", () => {
    expect(serializeShellVariable("v", "line1\nline2")).toBe("line1\nline2");
  });

  it("undefinedはエラーになる(変数名を含む)", () => {
    expect(() => serializeShellVariable("v", undefined)).toThrow(/"v"/);
  });

  it("functionはエラーになる", () => {
    expect(() => serializeShellVariable("v", () => {})).toThrow(/"v"/);
  });

  it("symbolはエラーになる", () => {
    expect(() => serializeShellVariable("v", Symbol("s"))).toThrow(/"v"/);
  });

  it("NUL文字を含む文字列はエラーになる(変数名を含む)", () => {
    expect(() => serializeShellVariable("v", "a\0b")).toThrow(/"v"/);
  });

  it("循環参照オブジェクトはエラーになる(変数名を含む)", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => serializeShellVariable("v", circular)).toThrow(/"v"/);
  });
});

describe("buildShellEnvironment (pure logic)", () => {
  it("base environmentを保持したうえで共有変数を追加する", () => {
    const env = buildShellEnvironment({ environment: "staging" }, { PATH: "/usr/bin", HOME: "/home/x" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    expect(env.DB_NOTEBOOK_VAR_environment).toBe("staging");
  });

  it("string/number/boolean/array/objectをまとめて変換する", () => {
    const env = buildShellEnvironment(
      {
        environment: "staging",
        retryCount: 3,
        dryRun: true,
        ids: [10, 20, 30],
        options: { output: "result.csv" },
      },
      {}
    );
    expect(env.DB_NOTEBOOK_VAR_environment).toBe("staging");
    expect(env.DB_NOTEBOOK_VAR_retryCount).toBe("3");
    expect(env.DB_NOTEBOOK_VAR_dryRun).toBe("true");
    expect(env.DB_NOTEBOOK_VAR_ids).toBe("[10,20,30]");
    expect(env.DB_NOTEBOOK_VAR_options).toBe('{"output":"result.csv"}');
  });

  it("先頭が_の内部制御用キー(例:_skipSql)はshellへ公開しない", () => {
    const env = buildShellEnvironment({ _skipSql: true, environment: "staging" }, {});
    expect(env.DB_NOTEBOOK_VAR__skipSql).toBeUndefined();
    expect(env.DB_NOTEBOOK_VAR_environment).toBe("staging");
  });

  it("同名のDB_NOTEBOOK_VAR_*が既存環境にあっても共有変数で上書きされる", () => {
    const env = buildShellEnvironment(
      { environment: "staging" },
      { DB_NOTEBOOK_VAR_environment: "from-host-env" }
    );
    expect(env.DB_NOTEBOOK_VAR_environment).toBe("staging");
  });

  it("予約prefixのため共有変数PATHは本来のPATHを上書きしない", () => {
    const env = buildShellEnvironment({ PATH: "not-a-real-path" }, { PATH: "/usr/bin" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.DB_NOTEBOOK_VAR_PATH).toBe("not-a-real-path");
  });

  it("不正な変数名(ハイフンを含む)はエラーになる", () => {
    expect(() => buildShellEnvironment({ "user-name": "x" }, {})).toThrow(/"user-name"/);
  });

  it("直列化できない値はbuildShellEnvironmentからもエラーとして伝播する", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => buildShellEnvironment({ v: circular }, {})).toThrow(/"v"/);
  });
});

describe("ShellKernel.run() + shared variables (real bash spawn)", () => {
  it("文字列の共有変数をDB_NOTEBOOK_VAR_<name>としてshellから参照できる", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell('echo "$DB_NOTEBOOK_VAR_environment"'), {
      environment: "staging",
    });

    expect(result.stdout.trim()).toBe("staging");
    expect(result.status).toBe("executed");
  }, 15000);

  it("数値・booleanの共有変数を参照できる", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(
      makeCell('echo "$DB_NOTEBOOK_VAR_retryCount,$DB_NOTEBOOK_VAR_dryRun"'),
      { retryCount: 3, dryRun: true }
    );

    expect(result.stdout.trim()).toBe("3,true");
  }, 15000);

  it("配列・オブジェクトの共有変数はJSON文字列として渡される", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(
      makeCell('printf "%s\\n%s\\n" "$DB_NOTEBOOK_VAR_ids" "$DB_NOTEBOOK_VAR_options"'),
      { ids: [10, 20, 30], options: { output: "result.csv" } }
    );

    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("[10,20,30]");
    expect(lines[1]).toBe('{"output":"result.csv"}');
  }, 15000);

  it("既存のPATHは共有変数を渡しても維持される", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell('[ -n "$PATH" ] && echo has-path'), {
      environment: "staging",
    });

    expect(result.stdout.trim()).toBe("has-path");
  }, 15000);

  it("不正な共有変数名はエラーとして終了し、変数名を含むメッセージを返す(shellを起動しない)", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell("echo should-not-run"), {
      "user-name": "x",
    });

    expect(result.status).toBe("error");
    expect(result.stderr).toContain('"user-name"');
    expect(result.stdout).not.toContain("should-not-run");
  }, 15000);

  it("共有変数を渡さない場合(引数省略)も従来どおり動作する", async () => {
    const kernel = await ShellKernel.create();
    const result = await kernel.run(makeCell("echo hello"));

    expect(result.stdout).toContain("hello");
    expect(result.status).toBe("executed");
  }, 15000);
});
