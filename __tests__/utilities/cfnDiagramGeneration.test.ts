import {
  generateDiagram,
  generateDrawioMultiAzDeploymentDataPaths,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";

const templateSource = `Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
`;

const params = {
  mode: "MultiAzDeploymentDataPaths" as const,
  list: [
    {
      fileName: "sample-stack",
      templateJSONString: JSON.stringify({
        Resources: {
          Vpc: {
            Type: "AWS::EC2::VPC",
            Properties: { CidrBlock: "10.0.0.0/16" },
          },
        },
      }),
      templateSource,
    },
  ],
  options: { includeLegend: true },
};

describe("CloudFormation diagram driver integration", () => {
  it("generates the formal Multi-AZ mode as Mermaid", () => {
    const diagram = generateDiagram(params);

    expect(diagram).toContain("```mermaid");
    expect(diagram).toContain("VPC 10.0.0.0/16");
  });

  it("generates draw.io with the diagram and template source pages", () => {
    const drawio = generateDrawioMultiAzDeploymentDataPaths(params);

    expect(drawio).toContain('<diagram id="multi-az-data-paths"');
    expect(drawio).toContain('name="Template: sample-stack"');
    expect(drawio).toContain("AWS::EC2::VPC");
  });
});
