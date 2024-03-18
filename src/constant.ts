import * as path from "path";
export const mediaDir = path.join(__filename, "..", "..", "media");

export const EXTENSION_NAME = "database-notebook";

//---------------------------------------------------
// CONNECTION SETTING FORM
//---------------------------------------------------
export const CONNECTION_SETTING_FORM_VIEWID = `${EXTENSION_NAME}.connectionForm`;
export const BOTTOM_MDH_VIEWID = `${EXTENSION_NAME}.view.bottom.mdh`;
export const BOTTOM_DIFF_MDH_VIEWID = `${EXTENSION_NAME}.view.bottom.diff-mdh`;

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
export const DUPLICATE_CONNECTION_SETTING = `${EXTENSION_NAME}.duplicate-connection-setting`;
export const DELETE_CONNECTION_SETTING = `${EXTENSION_NAME}.delete-connection-setting`;

export const SHOW_SCAN_PANEL = `${EXTENSION_NAME}.show-scan-panel`;
export const SHOW_METADATA_RDH = `${EXTENSION_NAME}.show-metadata-rdh`;
export const SHOW_RESOURCE_PROPERTIES = `${EXTENSION_NAME}.show-resource-properties`;
export const CREATE_ER_DIAGRAM = `${EXTENSION_NAME}.create-er-diagram`;
export const CREATE_ER_DIAGRAM_WITH_SETTINGS = `${EXTENSION_NAME}.create-er-diagram-with-settings`;
export const WRITE_ER_DIAGRAM_TO_CLIPBOARD = `${EXTENSION_NAME}.write-er-diagram-to-clipboard`;

export const CREATE_INSERT_SCRIPT_WITH_SETTINGS = `${EXTENSION_NAME}.create-insert-script-with-settings`;

//---------------------------------------------------
// SQL HISTORIES TREE
//---------------------------------------------------
export const REFRESH_SQL_HISTORIES = `${EXTENSION_NAME}.refresh-sql-histories`;
export const DELETE_ALL_SQL_HISTORY = `${EXTENSION_NAME}.delete-all-sql-histories`;
export const EXECUTE_SQL_HISTORY = `${EXTENSION_NAME}.histories.execute`;
export const OPEN_SQL_HISTORY = `${EXTENSION_NAME}.histories.open`;
export const DELETE_SQL_HISTORY = `${EXTENSION_NAME}.histories.delete`;

//---------------------------------------------------
// OPEN VIEWERS
//---------------------------------------------------
export const SHOW_CSV = `${EXTENSION_NAME}.show-csv-file`;
export const SHOW_HAR = `${EXTENSION_NAME}.show-har-file`;
export const OPEN_MDH_VIEWER = `${EXTENSION_NAME}.open-mdh-viewer`;
export const OPEN_DIFF_MDH_VIEWER = `${EXTENSION_NAME}.open-diff-mdh-viewer`;

//---------------------------------------------------
// NOTE BOOK
//---------------------------------------------------
export const CREATE_NEW_NOTEBOOK = `${EXTENSION_NAME}.create-blank-notebook`;
export const NOTEBOOK_TYPE = `${EXTENSION_NAME}-type`;

// NOTEBOOK TOOL-BAR COMMANDS
export const SHOW_NOTEBOOK_ALL_VARIABLES = `${EXTENSION_NAME}.toolbar.show-all-variables`;
export const SHOW_NOTEBOOK_ALL_RDH = `${EXTENSION_NAME}.toolbar.show-all-rdh`;
export const SPECIFY_CONNECTION_TO_ALL_CELLS = `${EXTENSION_NAME}.toolbar.specify-connection-all`;

// NOTEBOOK CELL STATUS-BAR COMMANDS
export const CELL_MARK_CELL_AS_SKIP = `${EXTENSION_NAME}.cell.mark-cell-as-skip`;
export const CELL_SHOW_METADATA_SETTINGS = `${EXTENSION_NAME}.cell.show-metadata-setting`;
export const CELL_SPECIFY_CONNECTION_TO_USE = `${EXTENSION_NAME}.cell.specify-connection-to-use`;
export const CELL_WRITE_TO_CLIPBOARD = `${EXTENSION_NAME}.cell.write-to-clipboard`;
export const CELL_OPEN_MDH = `${EXTENSION_NAME}.cell.open-mdh`;
export const CELL_OPEN_HTTP_RESPONSE = `${EXTENSION_NAME}.cell.open-http-response`;
export const CELL_MARK_CELL_AS_PRE_EXECUTION = `${EXTENSION_NAME}.cell.mark-cell-as-pre-execution`;

// NOTEBOOK CELL EXECUTE
export const CELL_EXECUTE_QUERY = `${EXTENSION_NAME}.cell-execute-query`;
export const CELL_EXECUTE_EXPLAIN = `${EXTENSION_NAME}.cell-execute-explain`;
export const CELL_EXECUTE_EXPLAIN_ANALYZE = `${EXTENSION_NAME}.cell-execute-explain-analyze`;

// NOTEBOOK CELL TITLE (CELL TOOLBAR-ACTION)
export const CELL_TOOLBAR_FORMAT = `${EXTENSION_NAME}.cell-toolbar-format`;

//---------------------------------------------------
// RECORD RULE EDITOR
//---------------------------------------------------
export const CREATE_NEW_RECORD_RULE = `${EXTENSION_NAME}.create-blank-record-rule`;
export const RECORD_RULE_TYPE = `${EXTENSION_NAME}.ruleEditor`;

//---------------------------------------------------
// CODE RESOLVER EDITOR
//---------------------------------------------------
export const CREATE_CODE_RESOLVER = `${EXTENSION_NAME}.create-blank-code-resolver`;
export const CODE_RESOLVER_TYPE = `${EXTENSION_NAME}.codeResolverEditor`;
