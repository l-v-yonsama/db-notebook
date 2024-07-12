import { ExtensionContext, Uri, workspace } from "vscode";
import * as path from "path";
import { log, logError } from "./logger";
import { mediaDir } from "../constant";
import * as fs from "fs";

let globalStorageUri: Uri;
let nodeModulesPath: Uri;
let storageTmpPath: string;

const PREFIX = "  [fsUtil]";

// For storage
export const initializeStoragePath = (context: ExtensionContext): void => {
  globalStorageUri = context.globalStorageUri;
  nodeModulesPath = Uri.file(context.asAbsolutePath("node_modules"));
};

export const initializeStorageTmpPath = async (tmpDirPath?: string): Promise<void> => {
  storageTmpPath = tmpDirPath ? tmpDirPath : path.join(globalStorageUri.fsPath, "tmp");
  if (!(await existsOnStorage(storageTmpPath))) {
    log(`${PREFIX} ⭐️initializeStorageTmpPath:[${storageTmpPath}]`);
    await mkdirsOnStorage(storageTmpPath);
  }
};

const mkdirsOnStorage = async (fsPath: string): Promise<void> => {
  try {
    await fs.promises.mkdir(fsPath, { recursive: true });
  } catch (err) {
    if (err instanceof Error) {
      logError(PREFIX + err.message);
    } else {
      logError(PREFIX + "Error:" + err);
    }
  }
};

export const createDirectoryOnTmpStorage = async (dirName: string): Promise<string> => {
  const dir = path.join(storageTmpPath, dirName);
  await mkdirsOnStorage(dir);
  log(`${PREFIX} createDirectoryOnTmpStorage:[${dir}]`);
  return dir;
};

export const existsOnStorage = async (fsPath: string): Promise<boolean> => {
  try {
    await fs.promises.stat(fsPath);
    return true;
  } catch (err) {
    if (err instanceof Error) {
      log(`${PREFIX} ⭐️existsOnStorage NG:[${err.message}] ${fsPath}`);
    } else {
      log(`${PREFIX} ⭐️existsOnStorage NG:[${err}] ${fsPath}`);
    }
    return false;
  }
};

export const writeToResourceOnStorage = async (fsPath: string, text: string): Promise<void> => {
  await fs.promises.writeFile(fsPath, text, { encoding: "utf8" });
};

export const readResourceOnStorage = async (fsPath: string): Promise<string> => {
  return await fs.promises.readFile(fsPath, { encoding: "utf8" });
};

export const deleteDirsOnStorage = async (fsPath: string): Promise<void> => {
  await fs.promises.rm(fsPath, { recursive: true, force: true });
};

export const getNodeModulePath = (name: string): string => {
  const moduleUri = Uri.joinPath(nodeModulesPath, name);
  return winToLinuxPath(moduleUri.fsPath);
};

export const getIconPath = (fileName: string): { readonly light: Uri; readonly dark: Uri } => {
  return {
    light: Uri.file(path.join(mediaDir, "light", fileName)),
    dark: Uri.file(path.join(mediaDir, "dark", fileName)),
  };
};

export const winToLinuxPath = (s: string) => s.replace(/\\/g, "/");

export const existsUri = async (uri: Uri): Promise<boolean> => {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch (err) {
    if (err instanceof Error) {
      log(`${PREFIX} ⭐️existsUri NG:[${err.message}] ${uri?.fsPath}`);
    } else {
      log(`${PREFIX} ⭐️existsUri NG:[${err}] ${uri?.fsPath}`);
    }
    return false;
  }
};

export const writeToResource = async (targetResource: Uri, text: string): Promise<void> => {
  // log(`${PREFIX} writeToResource [${targetResource}]`);
  const fileContents = Buffer.from(text, "utf8");
  await workspace.fs.writeFile(targetResource, fileContents);
};

export const readResource = async (targetResource: Uri): Promise<string> => {
  // log(`${PREFIX} readResource [${targetResource}]`);
  const readData = await workspace.fs.readFile(targetResource);
  return Buffer.from(readData).toString("utf8");
};

export const deleteResource = async (
  targetResource: Uri,
  options?: { recursive?: boolean; useTrash?: boolean }
): Promise<void> => {
  // log(`${PREFIX} deleteResource [${targetResource}]`);
  await workspace.fs.delete(targetResource, options);
};

export const existsFileOnWorkspace = async (fsPath: string): Promise<boolean> => {
  // log(`${PREFIX} existsFileOnWorkspace [${fsPath}]`);
  if (fsPath) {
    let wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return false;
    }

    const filePath = Uri.joinPath(wsfolder, fsPath);
    return await existsUri(filePath);
  }
  return false;
};

export const readFileOnWorkspace = async (fsPath: string): Promise<string | undefined> => {
  // log(`${PREFIX} readFileOnWorkspace [${fsPath}]`);
  if (fsPath) {
    let wsfolder = workspace.workspaceFolders?.[0].uri;
    if (!wsfolder) {
      return undefined;
    }
    const filePath = Uri.joinPath(wsfolder, fsPath);
    return await readResource(filePath);
  }
  return undefined;
};
