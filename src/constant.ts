import * as path from "path";
export const mediaDir = path.join(__filename, "..", "..", "media");

export const EXTENSION_NAME = "database-notebook";

export const REFRESH_RESOURCES = `${EXTENSION_NAME}.refresh-resources`;
export const RETRIEVE_RESOURCES = `${EXTENSION_NAME}.retrieve-resources`;
export const RETRIEVE_TABLE_RECORDS = `${EXTENSION_NAME}.retrieve-table-records`;
export const FLUSH_DB = `${EXTENSION_NAME}.flush-db`;
export const CREATE_CONNECTION_SETTING = `${EXTENSION_NAME}.create-connection-setting`;
export const SHOW_CONNECTION_SETTING = `${EXTENSION_NAME}.show-connection-setting`;
export const EDIT_CONNECTION_SETTING = `${EXTENSION_NAME}.edit-connection-setting`;
export const CLONE_CONNECTION_SETTING = `${EXTENSION_NAME}.clone-connection-setting`;
export const DELETE_CONNECTION_SETTING = `${EXTENSION_NAME}.delete-connection-setting`;

export const SHOW_SCAN_PANEL = `${EXTENSION_NAME}.show-scan-panel`;
export const SHOW_METADATA_RDH = `${EXTENSION_NAME}.show-metadata-rdh`;
export const SHOW_RESOURCE_PROPERTIES = `${EXTENSION_NAME}.show-resource-properties`;

export const SHOW_RDH_DIFF = `${EXTENSION_NAME}.show-rdh-diff`;
