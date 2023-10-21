import * as cp from "child_process";
import * as path from "path";
import { NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { ConnectionSetting, abbr } from "@l-v-yonsama/multi-platform-database-drivers";
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
import { NodeRunAxiosResponse, RunResultMetadata } from "../shared/RunResultMetadata";
import { URL } from "url";
import dayjs = require("dayjs");

const PREFIX = "  [notebook/NodeKernel]";

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
      const fstringify = require('${winToLinuxPath(
        path.join(nodeModules, "fast-json-stable-stringify")
      )}');
      const axios = require('${winToLinuxPath(
        path.join(nodeModules, "axios/dist/node/axios.cjs")
      )}');
      axios.interceptors.request.use( x => {
        x.meta = x.meta || {}
        x.meta.requestStartedAt = new Date().getTime();
        return x;
      });
      axios.interceptors.response.use(x => {
        x.config.meta.elapsedTime = new Date().getTime() - x.config.meta.requestStartedAt;
        delete x.config.meta.requestStartedAt;
        return x;
      });
      const variables = require('${winToLinuxPath(path.join(nodeModules, "store"))}');
      const {DBDriverResolver,ResultSetDataBuilder,parseContentType} = require('${winToLinuxPath(
        path.join(nodeModules, "@l-v-yonsama/multi-platform-database-drivers")
      )}');
      const getConnectionSettingByName = (s) => {
        const settings = ${JSON.stringify(this.connectionSettings)};
        const o = settings.find(it => it.name == s);
        if (o) {
          return o;
        }
        const names = settings.map(it => it.name).join(',');
        throw new Error('Connection settings not found. Available here [' + names + '].');
      };
      const writeResultSetData = (title, o) => {
        const rdb = ResultSetDataBuilder.from(o);
        const rdh = rdb.build();
        rdh.meta.tableName = title;
        variables.set('_ResultSetData', rdh);
      };

      const writeResponseData = (res) => {
        const headerList = ['Server','Content-Type','Content-Length','Cache-Control','Content-Encoding'];
        const headers = {};

        Object.keys(res.headers).forEach(name => {
          const lname = name.toLowerCase();
          const normalizedName = headerList.find(it => it.toLowerCase() === lname);
          if ( normalizedName ) {
            headers[normalizedName] = res.headers[name];
          } else {
            headers[name] = res.headers[name];
          }
        });

        let data = res.data;
        const contentTypeInfo = parseContentType({contentType:headers['Content-Type']});
        if (!contentTypeInfo.isTextValue) {
          data = res.data.toString('base64');
        }

        const resData = {
          data,
          status: res.status,
          statusText: res.statusText,
          elapsedTime: res.config.meta?.elapsedTime,
          headers,
          contentTypeInfo,
          config:{
            url: res.config.url,
            method: res.config.method,
            baseURL: res.config.baseURL,
            headers: res.config.headers,
            params: res.config.params,
            data: res.config.data,
            timeout: res.config.timeout,
          }
        };
        variables.set('_ResponseData', fstringify(resData));
      };

      const _saveVariables = () => {
        const saveMap = {};
        variables.each(function(value, key) {
          saveMap[key] = value;
        });
        myfs.writeFileSync('${winToLinuxPath(
          this.variablesFile.fsPath
        )}', fstringify(saveMap), {encoding:'utf8'});
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
    let metadata: RunResultMetadata = {};

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
    this.child = undefined;

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

    if (this.variables["_ResultSetData"]) {
      const rdh = this.variables["_ResultSetData"];
      delete this.variables["_ResultSetData"];
      metadata.rdh = rdh;
    }
    if (this.variables["_ResponseData"]) {
      const resString = this.variables["_ResponseData"];
      delete this.variables["_ResponseData"];
      const res = JSON.parse(resString) as NodeRunAxiosResponse;
      let title = `${dayjs().format("HH:mm:ss.SSS")}[${res.status}]`;
      if (res.config.url && res.config.method) {
        const url = new URL(res.config.url);
        title += `[${res.config.method}][${abbr(url.host + (url.pathname ?? ""), 16)}]`;
      }
      res.title = title;
      metadata.res = res;
    }

    return {
      stdout,
      stderr,
      skipped: false,
      metadata,
    };
  }

  interrupt() {
    if (this.child) {
      log(`${PREFIX} [interrupt] kill pid:${this.child.pid}`);
      try {
        const message = process.kill(this.child.pid);
        log(`${PREFIX} result:${message}`);
      } catch (e: any) {
        log(`${PREFIX} Error:${e.message}`);
      }
      this.child = undefined;
    } else {
      log(`${PREFIX} No interrupt target`);
    }
  }

  async dispose() {
    // log(`${PREFIX} dispose`);
    this.child = undefined;
    await deleteResource(this.tmpDirectory, { recursive: true });
  }
}
