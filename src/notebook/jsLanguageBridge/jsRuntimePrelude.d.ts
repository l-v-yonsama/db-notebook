// Ambient contract for the globals `NodeKernel.createScript()` injects into a JS cell's
// IIFE before execution (src/notebook/NodeKernel.ts). Keep this in sync by hand: if that
// method's injected globals change, update the declarations below to match.
import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
import type { ResultSetData } from "@l-v-yonsama/rdh";
import type { AxiosStatic } from "axios";

declare const myfs: typeof import("fs");
declare const execa: typeof import("execa");
declare const jmespath: typeof import("jmespath");
// axios's own .d.ts default-exports its instance, so `typeof import("axios")` would yield
// the ESM namespace shape ({ default: AxiosStatic, ... }), not the flat callable object
// NodeKernel actually produces via require("axios/dist/node/axios.cjs"). Use the named
// AxiosStatic interface directly instead.
declare const axios: AxiosStatic;

declare const DBDriverResolver: typeof import("@l-v-yonsama/multi-platform-database-drivers").DBDriverResolver;
declare const normalizeQuery: typeof import("@l-v-yonsama/multi-platform-database-drivers").normalizeQuery;
declare const parseContentType: typeof import("@l-v-yonsama/multi-platform-database-drivers").parseContentType;
declare const decodeJwt: typeof import("@l-v-yonsama/multi-platform-database-drivers").decodeJwt;
declare const ResultSetDataBuilder: typeof import("@l-v-yonsama/rdh").ResultSetDataBuilder;

// Mirrors the payload MainController._doExecution's updateVariable() call stores for a cell
// whose "Saving execution results in shared variables" is enabled (controller.ts, near
// `noteSession.kernel.updateVariable`) -- success/stdout/stderr/skipped/status always come
// through as-is; TMetadata narrows what that cell's own `metadata` looked like, e.g.
// `SavedCellResult<{ rdh: ResultSetData }>` for a SQL cell's result.
declare type SavedCellResult<TMetadata = Record<string, unknown>> = {
  success: boolean;
  stdout: string;
  stderr: string;
  skipped: boolean;
  status: string;
  metadata?: TMetadata;
};

declare const variables: {
  // optionalDefaultValue isn't required to be a *complete* T: for an object T it only has
  // to be Partial<T> (a minimal fallback like `{ success: false }` still type-checks, while
  // a typo'd key is still caught); for a non-object T (string/number/boolean/...) it must
  // match T exactly, since Partial<T> on a primitive doesn't mean what it looks like it
  // means (Partial<number> is the boxed Number interface, not number).
  get<T = unknown>(
    key: string,
    optionalDefaultValue?: T extends object ? Partial<T> : T
  ): T;
  set(key: string, value: unknown): unknown;
  each(callback: (value: unknown, key: string) => void): void;
  remove(key: string): void;
  clearAll(): void;
};

declare class variablesCell {
  static setKeyValueAtFirst(key: string, value: unknown): void;
  static replaceAllAtFirst(value: unknown): void;
  static setKeyValueAt(cellIndex: number, key: string, value: unknown): void;
  static replaceAllAt(cellIndex: number, value: unknown): void;
}

declare function getConnectionSettingByName(name: string): ConnectionSetting;
declare function writeResultSetData(title: string, o: unknown): void;
declare function writeResponseData(res: unknown): void;
declare function _skipSql(b: boolean): void;
