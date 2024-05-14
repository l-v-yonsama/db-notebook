import { ExtensionContext, Uri, workspace } from "vscode";
import * as path from "path";
import { log, logError } from "./logger";
import { mediaDir } from "../constant";
import * as fs from "fs";

let storagePath: Uri;
let nodeModulesPath: Uri;

const PREFIX = "  [fsUtil]";

// For storage
export const initializeStoragePath = (context: ExtensionContext): void => {
  storagePath = context.globalStorageUri;
  nodeModulesPath = Uri.file(context.asAbsolutePath("node_modules"));
};

export const initializeStorageTmpPath = async (): Promise<void> => {
  await mkdirsOnStorage(path.join(storagePath.fsPath, "tmp"));
};

const mkdirsOnStorage = async (fsPath: string): Promise<void> => {
  try {
    log(`${PREFIX} mkdirsOnStorage fsPath:${fsPath}`);
    const result = await fs.promises.mkdir(fsPath, { recursive: true });
    log(`${PREFIX} mkdirsOnStorage ok result:${result}`);
  } catch (err) {
    if (err instanceof Error) {
      logError(PREFIX + err.message);
    } else {
      logError(PREFIX + "Error:" + err);
    }
  }
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
    log(`${PREFIX} existsUri OK`);
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

export const writeToResourceOnStorage = async (fsPath: string, text: string): Promise<void> => {
  log(`${PREFIX} writeToResourceOnStorage [${fsPath}]`);
  await fs.promises.writeFile(fsPath, text, { encoding: "utf8" });
};

export const writeToResource = async (targetResource: Uri, text: string): Promise<void> => {
  // log(`${PREFIX} writeToResource [${targetResource}]`);
  const fileContents = Buffer.from(text, "utf8");
  await workspace.fs.writeFile(targetResource, fileContents);
  // todo:remove
  await existsUri(targetResource);
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

export const createDirectoryOnStorage = async (...pathSegments: string[]): Promise<Uri> => {
  const uri = Uri.joinPath(storagePath, ...pathSegments);

  await mkdirsOnStorage(uri.fsPath);
  // todo:remove
  await existsUri(uri);

  return uri;
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
