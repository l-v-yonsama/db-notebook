import * as path from "path";
export const mediaDir = path.join(__filename, "..", "..", "media");

export const EXTENSION_NAME = "database-notebook";

//---------------------------------------------------
// VIEWIDS
//---------------------------------------------------
export const CONNECTION_SETTING_FORM_VIEWID = `${EXTENSION_NAME}.connectionForm`;
export const BOTTOM_MDH_VIEWID = `${EXTENSION_NAME}.view.bottom.mdh`;
export const BOTTOM_DIFF_MDH_VIEWID = `${EXTENSION_NAME}.view.bottom.diff-mdh`;
export const BOTTOM_CHARTS_VIEWID = `${EXTENSION_NAME}.view.bottom.charts`;
export const BOTTOM_COUNT_FOR_ALL_TABLES_VIEWID = `${EXTENSION_NAME}.view.bottom.count-for-all-tables`;
export const BOTTOM_TOOLS_VIEWID = `${EXTENSION_NAME}.view.bottom.tools`;

//---------------------------------------------------
// RESOURCE TREE
//---------------------------------------------------
export const REFRESH_RESOURCES = `${EXTENSION_NAME}.refresh-resources`;
export const RETRIEVE_RESOURCES = `${EXTENSION_NAME}.retrieve-resources`;
export const SPECIFY_DEFAULT_CON_FOR_SQL_CELL = `${EXTENSION_NAME}.specify-default-connection-for-sql-cell`;
export const CLEAR_DEFAULT_CON_FOR_SQL_CELL = `${EXTENSION_NAME}.clear-default-connection-for-sql-cell`;
export const GET_LOCKS = `${EXTENSION_NAME}.get-locks`;
export const GET_SESSIONS = `${EXTENSION_NAME}.get-sessions`;
export const COUNT_FOR_ALL_TABLES = `${EXTENSION_NAME}.count-for-all-tables`;
export const RETRIEVE_TABLE_RECORDS = `${EXTENSION_NAME}.retrieve-table-records`;
export const FLUSH_DB = `${EXTENSION_NAME}.flush-db`;
export const CREATE_CONNECTION_SETTING = `${EXTENSION_NAME}.create-connection-setting`;
export const SHOW_CONNECTION_SETTING = `${EXTENSION_NAME}.show-connection-setting`;
export const EDIT_CONNECTION_SETTING = `${EXTENSION_NAME}.edit-connection-setting`;
export const DUPLICATE_CONNECTION_SETTING = `${EXTENSION_NAME}.duplicate-connection-setting`;
export const DELETE_CONNECTION_SETTING = `${EXTENSION_NAME}.delete-connection-setting`;

export const SHOW_SCAN_PANEL = `${EXTENSION_NAME}.show-scan-panel`;
export const SHOW_DYNAMO_QUERY_PANEL = `${EXTENSION_NAME}.show-dynamo-query-panel`;
export const SHOW_METADATA_RDH = `${EXTENSION_NAME}.show-metadata-rdh`;
export const SHOW_RESOURCE_PROPERTIES = `${EXTENSION_NAME}.show-resource-properties`;
export const CREATE_ER_DIAGRAM = `${EXTENSION_NAME}.create-er-diagram`;
export const CREATE_ER_DIAGRAM_WITH_SETTINGS = `${EXTENSION_NAME}.create-er-diagram-with-settings`;
export const WRITE_ER_DIAGRAM_TO_CLIPBOARD = `${EXTENSION_NAME}.write-er-diagram-to-clipboard`;

export const CREATE_INSERT_SCRIPT_WITH_SETTINGS = `${EXTENSION_NAME}.create-insert-script-with-settings`;

export const OPEN_CHAT_2_QUERY = `${EXTENSION_NAME}.open-chat-2-query`;

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
export const OPEN_CHARTS_VIEWER = `${EXTENSION_NAME}.open-diff-charts`;
export const OPEN_COUNT_FOR_ALL_TABLES_VIEWER = `${EXTENSION_NAME}.open-count-for-all-tables-viewer`;
export const OPEN_TOOLS_VIEWER = `${EXTENSION_NAME}.open-tools-viewer`;

//---------------------------------------------------
// NOTE BOOK
//---------------------------------------------------
export const CREATE_NEW_NOTEBOOK = `${EXTENSION_NAME}.create-blank-notebook`;
export const CREATE_NOTEBOOK_FROM_SQL = `${EXTENSION_NAME}.create-dbn-from-sql`;
export const NOTEBOOK_TYPE = `${EXTENSION_NAME}-type`;

// NOTEBOOK TOOL-BAR COMMANDS
export const SHOW_NOTEBOOK_ALL_VARIABLES = `${EXTENSION_NAME}.toolbar.show-all-variables`;
export const SHOW_NOTEBOOK_ALL_RDH = `${EXTENSION_NAME}.toolbar.show-all-rdh`;
export const SPECIFY_CONNECTION_TO_ALL_CELLS = `${EXTENSION_NAME}.toolbar.specify-connection-all`;
export const SPECIFY_USING_DB_TO_ALL_CELLS = `${EXTENSION_NAME}.toolbar.specify-using-database-all`;
export const EXPORT_IN_HTML = `${EXTENSION_NAME}.toolbar.export-in-html`;

// NOTEBOOK CELL STATUS-BAR COMMANDS
export const CELL_MARK_CELL_AS_SKIP = `${EXTENSION_NAME}.cell.mark-cell-as-skip`;
export const CELL_SHOW_METADATA_SETTINGS = `${EXTENSION_NAME}.cell.show-metadata-setting`;
export const CELL_SPECIFY_CONNECTION_TO_USE = `${EXTENSION_NAME}.cell.specify-connection-to-use`;
export const CELL_SPECIFY_LOG_GROUP_TO_USE = `${EXTENSION_NAME}.cell.specify-log-group-to-use`;
export const CELL_SPECIFY_LOG_GROUP_START_TIME_OFFSET_TO_USE = `${EXTENSION_NAME}.cell.specify-log-group-starttime-offset-to-use`;
export const CELL_OPEN_MDH = `${EXTENSION_NAME}.cell.open-mdh`;
export const CELL_OPEN_HTTP_RESPONSE = `${EXTENSION_NAME}.cell.open-http-response`;
export const CELL_MARK_CELL_AS_PRE_EXECUTION = `${EXTENSION_NAME}.cell.mark-cell-as-pre-execution`;

// NOTEBOOK CELL EXECUTE
export const CELL_EXECUTE_QUERY = `${EXTENSION_NAME}.cell-execute-query`;
export const CELL_EXECUTE_EXPLAIN = `${EXTENSION_NAME}.cell-execute-explain`;
export const CELL_EXECUTE_EXPLAIN_ANALYZE = `${EXTENSION_NAME}.cell-execute-explain-analyze`;

// NOTEBOOK CELL TITLE (CELL TOOLBAR-ACTION)
export const CELL_TOOLBAR_LM = `${EXTENSION_NAME}.cell-toolbar-lm`;
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
