import * as path from "path";
export const mediaDir = path.join(__filename, "..", "..", "media");

export const EXTENSION_NAME = "database-notebook";

export const SHOW_RDH_DIFF = `${EXTENSION_NAME}.show-rdh-diff`;

//---------------------------------------------------
// RESOURCE TREE
//---------------------------------------------------
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
export const CREATE_ER_DIAGRAM = `${EXTENSION_NAME}.create-er-diagram`;
export const CREATE_ER_DIAGRAM_WITH_SETTINGS = `${EXTENSION_NAME}.create-er-diagram-with-settings`;
export const WRITE_ER_DIAGRAM_TO_CLIPBOARD = `${EXTENSION_NAME}.write-er-diagram-to-clipboard`;

//---------------------------------------------------
// NOTE BOOK
//---------------------------------------------------
export const CREATE_NEW_NOTEBOOK = `${EXTENSION_NAME}.create-blank-notebook`;
export const NOTEBOOK_TYPE = `${EXTENSION_NAME}-type`;
export const CELL_SPECIFY_CONNECTION_TO_USE = `${EXTENSION_NAME}.cell.specify-connection-to-use`;
export const CELL_OPEN_MDH = `${EXTENSION_NAME}.cell.open-mdh`;
export const SHOW_ALL_VARIABLES = `${EXTENSION_NAME}.show-all-variables`;
export const SHOW_ALL_RDH = `${EXTENSION_NAME}.show-all-rdh`;

//---------------------------------------------------
// RECORD RULE EDITOR
//---------------------------------------------------
export const CREATE_NEW_RECORD_RULE = `${EXTENSION_NAME}.create-blank-record-rule`;
export const RECORD_RULE_TYPE = `${EXTENSION_NAME}-ruleEditor`;
