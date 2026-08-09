import type {
  AuxiliaryResourceTreatment,
  DiagramViewpoint,
} from "@l-v-yonsama/multi-platform-database-drivers";

export type CfnDiagramOutputFormat = "Mermaid" | "Drawio";

/** The panel's "generate" action params - everything CfnDiagramSettingsPanel needs to fetch
 * each selected stack's template and call generateDiagram(). Mirrors ERDiagramSettingParams'
 * role for ERDiagramSettingsPanel. */
export type CfnDiagramGenerateParams = {
  stackNames: string[];
  mode: "ApplicationDiagram" | "MultiAzDeploymentDataPaths" | "CfnDependencyGraph";
  viewpoint: DiagramViewpoint;
  auxiliaryTreatment: AuxiliaryResourceTreatment;
  outputFormat: CfnDiagramOutputFormat;
  includeLegend: boolean;
};
