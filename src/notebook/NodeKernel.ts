import * as vscode from "vscode";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RunResult } from "./controller";

const baseDir = path.join(__filename, "..", "..", "..");
const nodeModules = path.join(baseDir, "node_modules");

export class NodeKernel {
  private tmpDirectory: string;
  private storeFile: string;
  private scriptFile?: string;
  private time: number;

  constructor(private connectionSettingNames: string[]) {
    this.time = new Date().getTime();
    this.tmpDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "db-nodebook-"));
    this.storeFile = path.join(this.tmpDirectory, `store_${this.time}.json`);
  }

  async getStoredJSONString(): Promise<string> {
    try {
      await fs.promises.stat(this.storeFile);
      return await fs.promises.readFile(this.storeFile, { encoding: "utf8" });
    } catch (_) {}
    return "{}";
  }

  async getStoredJson(): Promise<{ [key: string]: any }> {
    const json = await this.getStoredJSONString();
    return JSON.parse(json);
  }

  // private createTsConfig(scriptName: string): string {
  //   return `
  //   {
  //     "compilerOptions": {
  //       "module": "commonjs",
  //       "noImplicitAny": false,
  //       "target": "es6",
  //       "lib": ["es6", "dom"],
  //       "sourceMap": false,
  //       "rootDir": ".",
  //       "strict": false,
  //       "skipLibCheck": true,
  //       "typeRoots": ["${path.join(nodeModules, "@types")}"]
  //     },
  //     "files": [
  //       "${scriptName}"
  //     ]
  //   }
  //   `;
  // }

  private async createScript(cell: vscode.NotebookCell): Promise<string> {
    const storedJsonString = await this.getStoredJSONString();

    return `
    (async () => {
      const myfs = require('fs');
      const store = require('${path.join(nodeModules, "store")}');
      const driver = require('${path.join(
        nodeModules,
        "@l-v-yonsama/multi-platform-database-drivers"
      )}');
      const _saveStore = () => {
        const saveMap = {};
        store.each(function(value, key) {
          saveMap[key] = value;
        });
        myfs.writeFileSync('${this.storeFile}', JSON.stringify(saveMap), {encoding:'utf8'});
      };
      const _skipSql = (b) => { store.set('_skipSql', b); };
      try {
        const o = ${storedJsonString};
        Object.keys(o).forEach(key =>{
          store.set(key, o[key]);
        });
      } catch(_){
        console.error(_);
      }
  
      try {
        ${cell.document.getText()}
        ;
        _saveStore();
      } catch(e) {
        console.error(e);
      }
    })();
    `;
  }

  public async run(cell: vscode.NotebookCell): Promise<RunResult> {
    const ext = cell.document.languageId === "javascript" ? "js" : "ts";
    const scriptName = `script_${this.time}.${ext}`;
    // const configFile = path.join(this.tmpDirectory, "tsconfig.json");
    // fs.writeFileSync(configFile, this.createTsConfig(scriptName));
    this.scriptFile = path.join(this.tmpDirectory, scriptName);

    const script = await this.createScript(cell);
    fs.writeFileSync(this.scriptFile, script);

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
        var reg = new RegExp("private.+" + path.basename(this.scriptFile + ""), "g");
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
    await fs.promises.rm(this.tmpDirectory, { recursive: true });
  }
}
