import type { Component } from "vue";
import type { ComponentName } from "./vscode";

// ===== View(データ・結果を表示するメインコンテンツ系) =====
import DBFormView from "@/components/DBFormView.vue";
import ChartsView from "@/components/views/ChartsView.vue";
import CountRecordView from "@/components/views/CountRecordView.vue";
import DiffMdhView from "@/components/views/DiffMdhView.vue";
import LogParseResultView from "@/components/views/LogParseResultView/LogParseResultView.vue";
import MdhView from "@/components/views/MdhView.vue";
import SubscriptionPayloadsView from "@/components/views/SubscriptionPayloadsView.vue";
import ToolsView from "@/components/views/ToolsView.vue";
import CloudWatchMetricsView from "@/components/CloudWatchMetricsView.vue";
import RdbDashboardView from "@/components/RdbDashboardView.vue";

// ===== Panel(設定・入力フォーム系) =====
import CfnDiagramSettings from "@/components/CfnDiagramSettings.vue";
import CreateInsertScriptSettingsPanel from "@/components/CreateInsertScriptSettingsPanel.vue";
import CsvParseSettingPanel from "@/components/CsvParseSettingPanel.vue";
import DBDumpSettingsPanel from "@/components/DBDumpSettingsPanel.vue";
import DBRestoreSettingsPanel from "@/components/DBRestoreSettingsPanel.vue";
import DynamoQueryPanel from "@/components/DynamoQueryPanel.vue";
import ERDiagramSettings from "@/components/ERDiagramSettings.vue";
import HarFilePanel from "@/components/HarFilePanel.vue";
import HttpEventPanel from "@/components/HttpEventPanel.vue";
import LogParseSettingPanel from "@/components/LogParseSettingPanel/LogParseSettingPanel.vue";
import NotebookCellMetadataPanel from "@/components/NotebookCellMetadataPanel.vue";
import PerformanceTuningBindParametersPanel from "@/components/PerformanceTuningBindParametersPanel.vue";
import PerformanceTuningPreviewPanel from "@/components/PerformanceTuningPreviewPanel.vue";
import AiDataMaskingPreviewPanel from "@/components/AiDataMaskingPreviewPanel.vue";
import PublishEditorPanel from "@/components/PublishEditorPanel.vue";
import ScanPanel from "@/components/ScanPanel.vue";
import SubscriptionSettingPanel from "@/components/SubscriptionSettingPanel.vue";
import VariablesPanel from "@/components/VariablesPanel.vue";
import ViewConditionPanel from "@/components/ViewConditionPanel.vue";
import WriteHttpEventToClipboardParamsPanel from "@/components/WriteHttpEventToClipboardParamsPanel.vue";

// ===== Editor(既存データの編集系) =====
import CodeResolverEditor from "@/components/CodeResolverEditor.vue";
import RecordRuleEditor from "@/components/RecordRuleEditor.vue";

// Maps each ComponentName to the Vue component App.vue mounts for it.
// Not every ComponentName has an entry (e.g. ExportHtmlParamsPanel has no
// corresponding component yet), so lookups must handle a missing entry.
export const componentRegistry: Partial<Record<ComponentName, Component>> &
  Record<"CloudWatchMetricsView" | "RdbDashboardView", Component> = {
  // ----- View -----
  DBFormView: DBFormView, // DB接続設定の作成・編集フォーム
  MdhView: MdhView, // クエリ実行結果(表形式)の表示
  DiffMdhView: DiffMdhView, // クエリ結果同士の差分表示
  CountRecordView: CountRecordView, // 選択テーブルのレコード件数表示
  ChartsView: ChartsView, // グラフ(チャート)表示
  ToolsView: ToolsView, // テーブル操作などの各種ツール
  LogParseResultView: LogParseResultView, // ログ解析結果の表示
  SubscriptionPayloadsView: SubscriptionPayloadsView, // MQTT等の受信ペイロード一覧表示
  CloudWatchMetricsView: CloudWatchMetricsView, // CloudWatch metric dashboard
  RdbDashboardView: RdbDashboardView, // RDB database dashboard

  // ----- Panel -----
  DBRestoreSettingsPanel: DBRestoreSettingsPanel, // DBリストア設定
  DBDumpSettingsPanel: DBDumpSettingsPanel, // DBダンプ設定
  HttpEventPanel: HttpEventPanel, // HTTPリクエスト/レスポンスの表示
  CreateInsertScriptSettingsPanel: CreateInsertScriptSettingsPanel, // INSERT文生成の設定
  CsvParseSettingPanel: CsvParseSettingPanel, // CSV取り込み設定
  LogParseSettingPanel: LogParseSettingPanel, // ログ解析設定
  HarFilePanel: HarFilePanel, // HARファイル(通信ログ)の表示
  ScanPanel: ScanPanel, // リソース/テーブルのスキャン(検索)
  DynamoQueryPanel: DynamoQueryPanel, // DynamoDBクエリの実行
  PublishEditorPanel: PublishEditorPanel, // MQTT publish/subscribeの編集
  SubscriptionSettingPanel: SubscriptionSettingPanel, // MQTT等のサブスクリプション設定
  ViewConditionPanel: ViewConditionPanel, // クエリ抽出条件の設定
  VariablesPanel: VariablesPanel, // 変数の一覧・編集
  WriteHttpEventToClipboardParamsPanel: WriteHttpEventToClipboardParamsPanel, // HTTPイベントのクリップボードコピー設定
  ERDiagramSettingsPanel: ERDiagramSettings, // ER図生成の設定
  CfnDiagramSettingsPanel: CfnDiagramSettings, // CloudFormation構成図生成の設定
  NotebookCellMetadataPanel: NotebookCellMetadataPanel, // ノートブックセルのメタデータ(グラフ設定等)編集
  PerformanceTuningPreviewPanel: PerformanceTuningPreviewPanel, // getPerformanceTuningContext() の送信プレビュー
  AiDataMaskingPreviewPanel: AiDataMaskingPreviewPanel, // LM/MCPツールの行データ送信プレビュー
  PerformanceTuningBindParametersPanel: PerformanceTuningBindParametersPanel, // Preview前のBind Parameters確認

  // ----- Editor -----
  RecordRuleEditor: RecordRuleEditor, // レコード検証ルールの編集
  CodeResolverEditor: CodeResolverEditor, // コード値(コードマスタ)解決設定の編集
};
