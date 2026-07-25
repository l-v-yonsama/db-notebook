import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { Uri, workspace } from "vscode";
import type { ExtensionContext } from "vscode";
import {
  createDirectory,
  createDirectoryOnTmpStorage,
  deleteDirsOnStorage,
  deleteFileOnStorage,
  deleteResource,
  existsFileOnWorkspace,
  existsOnStorage,
  existsUri,
  getIconPath,
  getNodeModulePath,
  initializeStoragePath,
  initializeStorageTmpPath,
  mkdirsOnStorage,
  readFileOnWorkspace,
  readResource,
  readResourceOnStorage,
  winToLinuxPath,
  writeBytesToResource,
  writeToResource,
  writeToResourceOnStorage,
} from "./fsUtil";

let scratchRoot: string;

beforeAll(() => {
  scratchRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fsUtil-test-"));
});

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
});

// `workspace.workspaceFolders` is typed readonly on the real vscode.d.ts that this
// import resolves to for type-checking (the mock swap only happens at test runtime),
// so writing to it needs a cast through `unknown` like the ExtensionContext fakes below.
type MockWorkspaceFolders = { uri: Uri; name?: string; index?: number }[] | undefined;

const setWorkspaceFolders = (folders: MockWorkspaceFolders): void => {
  (workspace as unknown as { workspaceFolders: MockWorkspaceFolders }).workspaceFolders = folders;
};

beforeEach(() => {
  vi.clearAllMocks();
  setWorkspaceFolders(undefined);
});

const scratchPath = (...segments: string[]): string => path.join(scratchRoot, ...segments);

describe("winToLinuxPath", () => {
  it("replaces backslashes with slashes", () => {
    expect(winToLinuxPath("C:\\foo\\bar")).toBe("C:/foo/bar");
  });

  it("leaves a slash-only path unchanged", () => {
    expect(winToLinuxPath("/foo/bar")).toBe("/foo/bar");
  });
});

describe("getIconPath", () => {
  it("returns light/dark icon Uris", () => {
    const result = getIconPath("connection.svg");
    expect(result.light.fsPath).toContain(path.join("light", "connection.svg"));
    expect(result.dark.fsPath).toContain(path.join("dark", "connection.svg"));
  });
});

describe("initializeStoragePath / getNodeModulePath", () => {
  it("builds a path under the extension's node_modules", () => {
    const context = {
      globalStorageUri: Uri.file(scratchPath("global-storage")),
      asAbsolutePath: (relativePath: string) => `/ext/root/${relativePath}`,
    } as unknown as ExtensionContext;

    initializeStoragePath(context);

    expect(getNodeModulePath("left-pad")).toBe("/ext/root/node_modules/left-pad");
  });
});

describe("initializeStorageTmpPath / createDirectoryOnTmpStorage", () => {
  it("creates the directory when it doesn't exist", async () => {
    const tmpRoot = scratchPath("tmp-init");
    expect(fs.existsSync(tmpRoot)).toBe(false);

    await initializeStorageTmpPath(tmpRoot);

    expect(fs.existsSync(tmpRoot)).toBe(true);
  });

  it("does nothing and doesn't throw when it already exists", async () => {
    const tmpRoot = scratchPath("tmp-init-twice");
    await initializeStorageTmpPath(tmpRoot);

    await expect(initializeStorageTmpPath(tmpRoot)).resolves.toBeUndefined();
    expect(fs.existsSync(tmpRoot)).toBe(true);
  });

  it("uses the tmp directory under globalStorageUri when tmpDirPath is omitted", async () => {
    const globalStorageDir = scratchPath("global-storage-default");
    const context = {
      globalStorageUri: Uri.file(globalStorageDir),
      asAbsolutePath: (relativePath: string) => path.join(globalStorageDir, relativePath),
    } as unknown as ExtensionContext;
    initializeStoragePath(context);

    await initializeStorageTmpPath();

    expect(fs.existsSync(path.join(globalStorageDir, "tmp"))).toBe(true);
  });

  it("creates a subdirectory under the created tmp directory", async () => {
    const tmpRoot = scratchPath("tmp-init-sub");
    await initializeStorageTmpPath(tmpRoot);

    const dir = await createDirectoryOnTmpStorage("job-1");

    expect(dir).toBe(path.join(tmpRoot, "job-1"));
    expect(fs.existsSync(dir)).toBe(true);
  });
});

describe("mkdirsOnStorage", () => {
  it("creates nested directories recursively", async () => {
    const dir = scratchPath("mkdirs", "a", "b", "c");

    await mkdirsOnStorage(dir);

    expect(fs.existsSync(dir)).toBe(true);
  });

  it("doesn't throw even when creation fails (the error is only logged)", async () => {
    const blockerFile = scratchPath("mkdirs-blocker");
    fs.writeFileSync(blockerFile, "not a directory");

    await expect(mkdirsOnStorage(path.join(blockerFile, "child"))).resolves.toBeUndefined();
  });
});

describe("existsOnStorage", () => {
  it("returns true for a path that exists", async () => {
    const filePath = scratchPath("exists-yes.txt");
    fs.writeFileSync(filePath, "x");

    expect(await existsOnStorage(filePath)).toBe(true);
  });

  it("returns false for a path that doesn't exist", async () => {
    expect(await existsOnStorage(scratchPath("exists-no.txt"))).toBe(false);
  });
});

describe("writeToResourceOnStorage / readResourceOnStorage", () => {
  it("reads back exactly what was written", async () => {
    const filePath = scratchPath("roundtrip.json");

    await writeToResourceOnStorage(filePath, JSON.stringify({ port: 4000 }));
    const text = await readResourceOnStorage(filePath);

    expect(JSON.parse(text)).toEqual({ port: 4000 });
  });

  it("rejects when reading a file that doesn't exist", async () => {
    await expect(readResourceOnStorage(scratchPath("missing.json"))).rejects.toThrow();
  });
});

describe("deleteDirsOnStorage", () => {
  it("deletes a directory recursively", async () => {
    const dir = scratchPath("delete-dirs", "nested");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "file.txt"), "x");

    await deleteDirsOnStorage(scratchPath("delete-dirs"));

    expect(fs.existsSync(scratchPath("delete-dirs"))).toBe(false);
  });

  it("doesn't throw for a path that doesn't exist", async () => {
    await expect(deleteDirsOnStorage(scratchPath("never-existed"))).resolves.toBeUndefined();
  });
});

describe("deleteFileOnStorage", () => {
  it("deletes a file", async () => {
    const filePath = scratchPath("delete-file.txt");
    fs.writeFileSync(filePath, "x");

    await deleteFileOnStorage(filePath);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("doesn't throw for a file that doesn't exist", async () => {
    await expect(deleteFileOnStorage(scratchPath("never-existed.txt"))).resolves.toBeUndefined();
  });
});

describe("existsUri", () => {
  it("returns true when workspace.fs.stat succeeds", async () => {
    (workspace.fs.stat as Mock).mockResolvedValue(undefined);

    expect(await existsUri(Uri.file("/any/path"))).toBe(true);
  });

  it("returns false when workspace.fs.stat fails", async () => {
    (workspace.fs.stat as Mock).mockRejectedValue(new Error("ENOENT"));

    expect(await existsUri(Uri.file("/any/path"))).toBe(false);
  });
});

describe("writeToResource", () => {
  it("converts the string to UTF-8 bytes and passes it to workspace.fs.writeFile", async () => {
    const uri = Uri.file("/any/file.txt");

    await writeToResource(uri, "hello");

    expect(workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    const [calledUri, calledBytes] = (workspace.fs.writeFile as Mock).mock.calls[0];
    expect(calledUri).toBe(uri);
    expect(Buffer.from(calledBytes).toString("utf8")).toBe("hello");
  });
});

describe("writeBytesToResource", () => {
  it("passes the bytes to workspace.fs.writeFile unchanged", async () => {
    const uri = Uri.file("/any/file.bin");
    const bytes = new Uint8Array([1, 2, 3]);

    await writeBytesToResource(uri, bytes);

    expect(workspace.fs.writeFile).toHaveBeenCalledWith(uri, bytes);
  });
});

describe("createDirectory", () => {
  it("passes the Uri to workspace.fs.createDirectory unchanged", async () => {
    const uri = Uri.file("/any/dir");

    await createDirectory(uri);

    expect(workspace.fs.createDirectory).toHaveBeenCalledWith(uri);
  });
});

describe("readResource", () => {
  it("returns the workspace.fs.readFile result as a UTF-8 string", async () => {
    (workspace.fs.readFile as Mock).mockResolvedValue(Buffer.from("hello", "utf8"));

    const text = await readResource(Uri.file("/any/file.txt"));

    expect(text).toBe("hello");
  });
});

describe("deleteResource", () => {
  it("passes the Uri and options to workspace.fs.delete unchanged", async () => {
    const uri = Uri.file("/any/file.txt");

    await deleteResource(uri, { recursive: true, useTrash: false });

    expect(workspace.fs.delete).toHaveBeenCalledWith(uri, { recursive: true, useTrash: false });
  });

  it("passes undefined when options is omitted", async () => {
    const uri = Uri.file("/any/file.txt");

    await deleteResource(uri);

    expect(workspace.fs.delete).toHaveBeenCalledWith(uri, undefined);
  });
});

describe("existsFileOnWorkspace", () => {
  it("returns false for an empty path", async () => {
    expect(await existsFileOnWorkspace("")).toBe(false);
  });

  it("returns false when no workspace is open", async () => {
    expect(await existsFileOnWorkspace("foo.txt")).toBe(false);
  });

  it("returns true when the file exists under the first workspace folder", async () => {
    setWorkspaceFolders([{ uri: Uri.file("/ws") }]);
    (workspace.fs.stat as Mock).mockResolvedValue(undefined);

    expect(await existsFileOnWorkspace("foo.txt")).toBe(true);
    const [calledUri] = (workspace.fs.stat as Mock).mock.calls[0];
    expect(calledUri.fsPath).toBe("/ws/foo.txt");
  });

  it("returns false when the file doesn't exist under the first workspace folder", async () => {
    setWorkspaceFolders([{ uri: Uri.file("/ws") }]);
    (workspace.fs.stat as Mock).mockRejectedValue(new Error("ENOENT"));

    expect(await existsFileOnWorkspace("foo.txt")).toBe(false);
  });
});

describe("readFileOnWorkspace", () => {
  it("returns undefined for an empty path", async () => {
    expect(await readFileOnWorkspace("")).toBeUndefined();
  });

  it("returns undefined when no workspace is open", async () => {
    expect(await readFileOnWorkspace("foo.txt")).toBeUndefined();
  });

  it("returns the file contents under the first workspace folder", async () => {
    setWorkspaceFolders([{ uri: Uri.file("/ws") }]);
    (workspace.fs.readFile as Mock).mockResolvedValue(Buffer.from("hello", "utf8"));

    expect(await readFileOnWorkspace("foo.txt")).toBe("hello");
    const [calledUri] = (workspace.fs.readFile as Mock).mock.calls[0];
    expect(calledUri.fsPath).toBe("/ws/foo.txt");
  });
});
