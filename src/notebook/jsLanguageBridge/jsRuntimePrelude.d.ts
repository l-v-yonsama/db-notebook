// Ambient contract for the globals `NodeKernel.createScript()` injects into a JS cell's
// IIFE before execution (src/notebook/NodeKernel.ts). Keep this in sync by hand: if that
// method's injected globals change, update the declarations below to match.
import type { ConnectionSetting } from "@l-v-yonsama/multi-platform-database-drivers";
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

declare const variables: {
  get(key: string, optionalDefaultValue?: unknown): unknown;
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
