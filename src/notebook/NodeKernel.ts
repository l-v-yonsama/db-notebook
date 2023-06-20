import * as cp from "child_process";
import * as path from "path";
import { NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import { log } from "../utilities/logger";
import { NotebookCell, Uri } from "vscode";
import {
  createDirectoryOnStorage,
  deleteResource,
  existsUri,
  readResource,
  winToLinuxPath,
  writeToResource,
} from "../utilities/fsUtil";

const PREFIX = "[notebook/NodeKernel]";

const baseDir = path.join(__filename, "..", "..", "..");
const nodeModules = path.join(baseDir, "node_modules");

export class NodeKernel {
  private variablesFile: Uri;
  private scriptFile?: Uri;
  private child: cp.ChildProcess | undefined;
  private variables: NotebookExecutionVariables;

  private constructor(private connectionSettings: ConnectionSetting[], private tmpDirectory: Uri) {
    this.variablesFile = Uri.joinPath(this.tmpDirectory, "storedVariables.json");
    this.variables = {};
  }

  static async create(connectionSettings: ConnectionSetting[]): Promise<NodeKernel> {
    const tmpDir = await createDirectoryOnStorage("tmp", `${new Date().getTime()}`);
    return new NodeKernel(connectionSettings, tmpDir);
  }

  getStoredVariables(): NotebookExecutionVariables {
    return this.variables;
  }

  updateVariable(key: string, val: any) {
    this.variables[key] = val;
  }

  private async createScript(cell: NotebookCell): Promise<string> {
    const variablesJsonString = JSON.stringify(this.variables);

    return `
    (async () => {
      const myfs = require('fs');
      const variables = require('${winToLinuxPath(path.join(nodeModules, "store"))}');
      const mdd = require('${winToLinuxPath(
        path.join(nodeModules, "@l-v-yonsama/multi-platform-database-drivers")
      )}');
      const driverResolver = mdd.DBDriverResolver;
      const getConnectionSettingByName = (s) => {
        const settings = ${JSON.stringify(this.connectionSettings)};
        const o = settings.find(it => it.name == s);
        if (o) {
          return o;
        }
        const names = settings.map(it => it.name).join(',');
        throw new Error('Connection settings not found. Available here [' + names + '].');
      };

      const _saveVariables = () => {
        const saveMap = {};
        variables.each(function(value, key) {
          saveMap[key] = value;
        });
        myfs.writeFileSync('${winToLinuxPath(
          this.variablesFile.fsPath
        )}', JSON.stringify(saveMap), {encoding:'utf8'});
      };
      const _skipSql = (b) => { variables.set('_skipSql', b); };
      try {
        const o = ${variablesJsonString};
        Object.keys(o).forEach(key =>{
          variables.set(key, o[key]);
        });
      } catch(_){
        console.error(_);
      }
  
      try {
        ${cell.document.getText()}
        ;
        _saveVariables();
      } catch(e) {
        console.error(e);
      }
    })();
    `;
  }

  public async run(cell: NotebookCell): Promise<RunResult> {
    const ext = cell.document.languageId === "javascript" ? "js" : "ts";
    const scriptName = `script.${ext}`;
    this.scriptFile = Uri.joinPath(this.tmpDirectory, scriptName);

    const script = await this.createScript(cell);
    await writeToResource(this.scriptFile, script);

    this.child = cp.spawn("node", [this.scriptFile.fsPath]);

    let stdout = "";
    let stderr = "";

    const promise = new Promise((resolve, reject) => {
      if (this.child) {
        if (this.child.stdout) {
          this.child.stdout.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
        }
        if (this.child.stderr) {
          this.child.stderr.on("data", (data) => {
            stderr += data.toString();
          });
        }
        this.child.on("error", reject);
        this.child.on("close", (code) => {
          resolve(code);
        });
      } else {
        reject();
      }
    });
    await promise;

    const reg = new RegExp(".*" + path.basename(this.scriptFile.fsPath) + ":[0-9]+\r?\n *");
    stderr = stderr.replace(reg, "");
    stderr = stderr.replace(/ +at +[a-zA-Z0-9()/. :_\[\]-]+/g, "");
    stderr = stderr.replace(/Node.js v[0-9.:-]+/, "");
    stderr = stderr.replace(/\r\n/g, "\n");
    stderr = stderr.replace(/\n+/g, "\n");

    try {
      if (await existsUri(this.variablesFile)) {
        this.variables = JSON.parse(await readResource(this.variablesFile));
      }
    } catch (e: any) {
      log(`${PREFIX} ⭐️ERROR: retrieve variables [${e.message}]`);
    }

    return {
      stdout,
      stderr,
    };
  }

  interrupt() {
    log(`${PREFIX} interrupt`);
    if (this.child) {
      process.kill(this.child.pid);
      this.child = undefined;
    }
  }

  async dispose() {
    log(`${PREFIX} dispose`);
    this.child = undefined;
    await deleteResource(this.tmpDirectory, { recursive: true });
  }
}
