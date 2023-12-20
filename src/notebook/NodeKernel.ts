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
import { NodeRunAxiosEvent, RunResultMetadata } from "../shared/RunResultMetadata";
import { URL } from "url";
import dayjs = require("dayjs");
import { Entry } from "har-format";

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
      const _harTracker = require('${winToLinuxPath(path.join(nodeModules, "axios-har-tracker"))}');
      const _axiosTracker = new _harTracker.AxiosHarTracker(axios); 
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
        try {
          const har = _axiosTracker.getGeneratedHar();
          const rc = res.config;
          const entry = har.log.entries.find(it => it.request.url===rc.url && it.request.method === rc.method && it.response.status === res.status);
    
          if(entry){
            if(res.config.baseURL) {
              entry.request.url = res.config.baseURL + res.config.url;
            }

            const realMimeType = entry.response.headers.find(it=>it.name.toLowerCase()==='content-type')?.value;
            if( realMimeType !==  undefined){
              entry.response.content.mimeType = realMimeType;
            }
            
            if( entry.response.content.mimeType.startsWith('text/') && res.data !== undefined && typeof(res.data)==='string' ){
              const size = res.data.length;
              entry.response.bodySize = size;
              entry.response.content.size = size;
              entry.response.content.text = res.data;
            }

            if(res.data && Buffer.isBuffer(res.data)){
              entry.response.content.text = res.data.toString('base64');
              entry.response.content.encoding = 'base64';
            }

            entry.time = res.config.meta?.elapsedTime;
            entry.response.time = res.config.meta?.elapsedTime;
            variables.set('_ResponseData', fstringify(entry));  
          }  
        } catch(e){
          console.error(e);
        }
      };

      const setKeyValueOnJsonCell = (cellIndex, key, value) => {
        variables.set('_CellJSONKeyValue', fstringify({cellIndex, key, value}));  
      };

      const replaceAllOnJsonCell = (cellIndex, value) => {
        variables.set('_CellJSONValue', fstringify({cellIndex, value}));  
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
      const entry = JSON.parse(resString) as Entry;

      let title = `${dayjs().format("HH:mm:ss.SSS")}[${entry.response.status}]`;
      if (entry.request.url) {
        let urlString = entry.request.url;
        try {
          const url = new URL(entry.request.url);
          urlString = url.host + (url.pathname ?? "");
        } catch (_) {}
        if (entry.request.method) {
          title += `[${entry.request.method}][${abbr(urlString, 22)}]`;
        }
      }

      metadata.axiosEvent = {
        title,
        entry,
      };
    }

    if (this.variables["_CellJSONKeyValue"]) {
      const cellJsonValue = this.variables["_CellJSONKeyValue"];
      delete this.variables["_CellJSONKeyValue"];
      const v = JSON.parse(cellJsonValue);
      if (v.key) {
        metadata.updateCellJSONValue = v;
      }
    }

    if (this.variables["_CellJSONValue"]) {
      const cellJsonValue = this.variables["_CellJSONValue"];
      delete this.variables["_CellJSONValue"];
      metadata.updateCellJSONValue = JSON.parse(cellJsonValue);
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

  queryStringToJSON(queryString: string): { [key: string]: any } | undefined {
    if (queryString.length === 0) {
      return undefined;
    }
    var pairs = queryString.split("&");
    var result: { [key: string]: any } = {};
    pairs.forEach((pair) => {
      const p = pair.split("=");
      result[p[0]] = decodeURIComponent(p[1] || "");
    });
    return result;
  }
}
