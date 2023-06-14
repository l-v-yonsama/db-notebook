import { Uri, workspace } from "vscode";
import { log } from "./logger";

let storagePath: Uri;

const PREFIX = "  [fsUtil]";

export const setStoragePath = (s: Uri): void => {
  storagePath = s;
};

export const existsUri = async (uri: Uri): Promise<boolean> => {
  try {
    await workspace.fs.stat(uri);
    log(`${PREFIX} existsUri OK`);
    return true;
  } catch (err: any) {
    log(`${PREFIX} ⭐️existsUri NG:[${err.message}]`);
    return false;
  }
};

export const writeToResource = async (targetResource: Uri, text: string): Promise<void> => {
  log(`${PREFIX} writeToResource [${targetResource}]`);
  const fileContents = Buffer.from(text, "utf8");
  await workspace.fs.writeFile(targetResource, fileContents);
};

export const readResource = async (targetResource: Uri): Promise<string> => {
  log(`${PREFIX} readResource [${targetResource}]`);
  const readData = await workspace.fs.readFile(targetResource);
  return Buffer.from(readData).toString("utf8");
};

export const deleteResource = async (
  targetResource: Uri,
  options?: { recursive?: boolean; useTrash?: boolean }
): Promise<void> => {
  log(`${PREFIX} deleteResource [${targetResource}]`);
  await workspace.fs.delete(targetResource, options);
};

export const createDirectoryOnStorage = async (...pathSegments: string[]): Promise<Uri> => {
  const uri = Uri.joinPath(storagePath, ...pathSegments);
  log(`${PREFIX} createDirectory [${uri}]`);
  await workspace.fs.createDirectory(uri);
  return uri;
};

export const existsFileOnStorage = async (fsPath: string): Promise<boolean> => {
  log(`${PREFIX} existsFileOnStorage [${fsPath}]`);
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

export const readFileOnStorage = async (fsPath: string): Promise<string | undefined> => {
  log(`${PREFIX} readFileOnStorage [${fsPath}]`);
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
