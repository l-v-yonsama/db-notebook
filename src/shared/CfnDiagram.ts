import type {
  AuxiliaryResourceTreatment,
  DiagramViewpoint,
} from "@l-v-yonsama/multi-platform-database-drivers";

/** The panel's "generate" action params - everything CfnDiagramSettingsPanel needs to fetch
 * each selected stack's template and call generateDiagram(). Mirrors ERDiagramSettingParams'
 * role for ERDiagramSettingsPanel. */
export type CfnDiagramGenerateParams = {
  stackNames: string[];
  mode: "CfnDependencyGraph" | "ArchitectureDiagram";
  viewpoint: DiagramViewpoint;
  auxiliaryTreatment: AuxiliaryResourceTreatment;
};
