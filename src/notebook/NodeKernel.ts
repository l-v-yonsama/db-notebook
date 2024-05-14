import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import * as iconv from "iconv-lite";
import { NotebookExecutionVariables, RunResult } from "../types/Notebook";
import { ConnectionSetting, abbr } from "@l-v-yonsama/multi-platform-database-drivers";
import { log, logError } from "../utilities/logger";
import { NotebookCell, Uri, window, workspace } from "vscode";
import {
  createDirectoryOnStorage,
  deleteResource,
  existsUri,
  readResource,
  winToLinuxPath,
  writeToResource,
  writeToResourceOnStorage,
} from "../utilities/fsUtil";
import { RunResultMetadata } from "../shared/RunResultMetadata";
import { URL } from "url";
import dayjs = require("dayjs");
import { Entry } from "har-format";
import { getNodeConfig } from "../utilities/configUtil";
import { EMOJI } from "../types/Emoji";

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
    console.log("tmpDir", tmpDir.fsPath);
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
      const execa = require('${winToLinuxPath(path.join(nodeModules, "execa"))}');
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
      const {DBDriverResolver,ResultSetDataBuilder,normalizeQuery,parseContentType,decodeJwt} = require('${winToLinuxPath(
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

      class variablesCell {
        static setKeyValueAtFirst(key, value) {
          if ( typeof key !== 'string' ) {
            throw new Error('the key type must be "string".');
          }
          variablesCell.setKeyValueAt(0, key, value);
        }
  
        static replaceAllAtFirst(value) {
          variablesCell.replaceAllAt(0, value);
        }
  
        static setKeyValueAt(cellIndex, key, value) {
          if ( typeof key !== 'string' ) {
            throw new Error('the key type must be "string".');
          }
          const arr = JSON.parse(variables.get('_UpdateJSONCellValues') ?? '[]');
          let meta = arr.find(it => it.cellIndex === cellIndex);
          if ( meta === undefined ) {
            meta = { cellIndex, replaceAll: false, data: {} };
            arr.push(meta);
          }
          meta.data[key] = value;
          variables.set('_UpdateJSONCellValues', fstringify(arr));  
        }
  
        static replaceAllAt(cellIndex, value) {
          const arr = JSON.parse(variables.get('_UpdateJSONCellValues') ?? '[]');
          if ( meta === undefined ) {
            meta = { cellIndex, replaceAll: true, data: {} };
            arr.push(meta);
          }
          meta.replaceAll = true;
          meta.data = value;
          variables.set('_UpdateJSONCellValues', fstringify(arr)); 
        }
      }

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
        if (e.isAxiosError) {
          const {config,request,response, ...others} = e;
          if ( response ) {
            others.response = {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers,
              data: response.data
            };  
          }
          console.error(others);
        } else {
          console.error(e);
        }
      }
    })();
    `;
  }

  public async run(cell: NotebookCell): Promise<RunResult> {
    log(`${PREFIX} run START`);
    const ext = cell.document.languageId === "javascript" ? "js" : "ts";
    const scriptName = `script.${ext}`;
    this.scriptFile = Uri.joinPath(this.tmpDirectory, scriptName);

    const script = await this.createScript(cell);
    await writeToResourceOnStorage(this.scriptFile.fsPath, script);
    await existsUri(this.scriptFile);

    let stdout = "";
    let stderr = "";
    let metadata: RunResultMetadata = {};

    try {
      const rootUri = workspace.workspaceFolders?.[0].uri;
      const { commandPath, dataEncoding } = getNodeConfig();
      const options: cp.CommonSpawnOptions = {};
      if (rootUri) {
        options.cwd = rootUri.fsPath;
      }

      log(`${PREFIX} run before spawn`);
      if (commandPath) {
        this.child = cp.spawn(commandPath, [this.scriptFile.fsPath], options);
      } else {
        this.child = cp.spawn("node", [this.scriptFile.fsPath], options);
      }
      log(`${PREFIX} run after spawn`);

      const promise = new Promise((resolve, reject) => {
        if (this.child) {
          if (this.child.stdout) {
            this.child.stdout.on("data", (data: Buffer) => {
              if (dataEncoding) {
                stdout += iconv.decode(data, dataEncoding);
              } else {
                stdout += data.toString();
              }
            });
          }
          if (this.child.stderr) {
            this.child.stderr.on("data", (data) => {
              if (dataEncoding) {
                stderr += iconv.decode(data, dataEncoding);
              } else {
                stderr += data.toString();
              }
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
    } catch (err) {
      console.error(err);
      logError(`${PREFIX} run spawn::` + err);
      const errorMessages = ["Error while trying to spawn a child process."];

      // You can configure Visual Studio Code
      // open the Settings editor, navigate to Code > Settings > Settings. Alternately, open the Settings editor from the Command Palette (⇧⌘P)

      if (err instanceof Error) {
        log(`${PREFIX} run err is Error instance.`);
        errorMessages.push(err.message);
        errorMessages.push(
          `${EMOJI.warning} Set or verify the path to the Node.js executable used to run JavaScript.`
        );
        errorMessages.push(`${EMOJI.information} Set up your environment variables.`);
        errorMessages.push(`${EMOJI.information} Go to File or Code > Preferences > Settings.`);
        errorMessages.push(
          `${EMOJI.information} Enter the key word "database-notebook node path" in the Search bar.`
        );
        errorMessages.push(
          `${EMOJI.information} Copy the path to the Node.js file installed on your PC, and paste it.`
        );
        return {
          stdout,
          stderr: errorMessages.join(os.EOL),
          skipped: false,
          metadata,
        };
      } else {
        log(`${PREFIX} run err is not Error instance.`);
      }
      throw err;
    }

    this.child = undefined;

    const reg = new RegExp(".*" + path.basename(this.scriptFile.fsPath) + ":[0-9]+\r?\n *");
    stderr = stderr.replace(reg, "");
    stderr = stderr.replace(/ +at +[a-zA-Z0-9()/. :_\[\]-]+/g, "");
    stderr = stderr.replace(/Node.js v[0-9.:-]+/, "");
    stderr = stderr.replace(/\r\n/g, "\n");
    stderr = stderr.replace(/\n+/g, "\n");

    log(`${PREFIX} run parse variables`);

    try {
      if (await existsUri(this.variablesFile)) {
        this.variables = JSON.parse(await readResource(this.variablesFile));
      }
    } catch (e) {
      if (e instanceof Error) {
        log(`${PREFIX} retrieve variables Error:${e.message}`);
      } else {
        log(`${PREFIX} retrieve variables Error:${e}`);
      }
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

    if (this.variables["_UpdateJSONCellValues"]) {
      const cellJsonValue = this.variables["_UpdateJSONCellValues"];
      delete this.variables["_UpdateJSONCellValues"];
      const v = JSON.parse(cellJsonValue);
      if (v && v.length > 0) {
        metadata.updateJSONCellValues = v;
      }
    }
    log(`${PREFIX} run END`);

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
      } catch (e) {
        if (e instanceof Error) {
          log(`${PREFIX} [interrupt] Error:${e.message}`);
        } else {
          log(`${PREFIX} [interrupt] Error:${e}`);
        }
      }
      this.child = undefined;
    } else {
      log(`${PREFIX} No interrupt target`);
    }
  }

  async dispose() {
    // log(`${PREFIX} dispose`);
    this.child = undefined;
    // TODO: 元に戻す
    // await deleteResource(this.tmpDirectory, { recursive: true });
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
