import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";

const baseDir = path.join(__filename, "..", "..", "..");
const nodeModules = path.join(baseDir, "node_modules");

const winToLinuxPath = (s: string) => s.replace(/\\/g, "/");

export class NodeKernel {
  private tmpDirectory: string;
  private variablesFile: string;
  private scriptFile?: string;
  private time: number;

  constructor(private connectionSettings: ConnectionSetting[]) {
    this.time = new Date().getTime();
    this.tmpDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "db-nodebook-"));
    this.variablesFile = winToLinuxPath(path.join(this.tmpDirectory, `store_${this.time}.json`));
  }

  async getStoredVariablesString(): Promise<string> {
    try {
      await fs.promises.stat(this.variablesFile);
      return await fs.promises.readFile(this.variablesFile, { encoding: "utf8" });
    } catch (_) {}
    return "{}";
  }

  async getStoredVariables(): Promise<NotebookExecutionVariables> {
    const json = await this.getStoredVariablesString();
    return JSON.parse(json);
  }

  private async createScript(cell: vscode.NotebookCell): Promise<string> {
    const variablesJsonString = await this.getStoredVariablesString();
    console.log(winToLinuxPath(path.join(nodeModules, "store")));

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
        myfs.writeFileSync('${this.variablesFile}', JSON.stringify(saveMap), {encoding:'utf8'});
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

  public async run(cell: vscode.NotebookCell): Promise<RunResult> {
    const ext = cell.document.languageId === "javascript" ? "js" : "ts";
    const scriptName = `script_${this.time}.${ext}`;
    this.scriptFile = path.join(this.tmpDirectory, scriptName);

    const script = await this.createScript(cell);
    fs.writeFileSync(winToLinuxPath(this.scriptFile), script);

    let child: cp.ChildProcess;
    if (ext === "js") {
      child = cp.spawn("node", [this.scriptFile]);
    } else {
      // const command = path.join(nodeModules, ".bin", "ts-node");
      // const args = ["-P", configFile, this.scriptFile];
      // child = cp.spawn(command, args);
    }
    let stdout = "";
    let stderr = "";
    const promise = new Promise((resolve, reject) => {
      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
      }
      if (child.stderr) {
        child.stderr.on("data", (data) => {
          stderr += data.toString();
        });
      }
      child.on("error", reject);
      child.on("close", (code) => {
        resolve(code);
      });
    });
    await promise;

    const reg = new RegExp(".*" + path.basename(this.scriptFile) + ":[0-9]+\r?\n *");
    stderr = stderr.replace(reg, "");
    stderr = stderr.replace(/ +at +[a-zA-Z0-9()/. :_\[\]-]+/g, "");
    stderr = stderr.replace(/Node.js v[0-9.:-]+/, "");
    stderr = stderr.replace(/\r\n/g, "\n");
    stderr = stderr.replace(/\n+/g, "\n");
    console.log(stderr);
    return {
      stdout,
      stderr,
    };
  }

  async dispose() {
    console.log("remove dir ", this.tmpDirectory);
    await fs.promises.rm(this.tmpDirectory, { recursive: true });
  }
}
