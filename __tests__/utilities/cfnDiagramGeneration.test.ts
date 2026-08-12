import {
  generateDiagram,
  generateDrawioMultiAzDeploymentTrafficPathsAndProtection,
  generateDrawioMultiAzDeploymentTrafficPathsAndProtectionAsync,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { describe, expect, it } from "vitest";

const templateSource = `Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
`;

const params = {
  mode: "MultiAzDeploymentTrafficPathsAndProtection" as const,
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

  it("generates draw.io with the diagram and template source pages (legacy sync API)", () => {
    const drawio = generateDrawioMultiAzDeploymentTrafficPathsAndProtection(params);

    expect(drawio).toContain('<diagram id="multi-az-traffic-paths-protection"');
    expect(drawio).toContain('name="Template: sample-stack"');
    expect(drawio).toContain("AWS::EC2::VPC");
  });

  // CfnDiagramSettingsPanel.ts actually calls the *Async (ELK auto-layout) variant - this is the
  // one that matters for what a user sees in db-notebook.
  it("generates draw.io with the diagram and template source pages (auto-layout async API)", async () => {
    const drawio = await generateDrawioMultiAzDeploymentTrafficPathsAndProtectionAsync(params);

    expect(drawio).toContain('<diagram id="multi-az-traffic-paths-protection"');
    expect(drawio).toContain('name="Template: sample-stack"');
    expect(drawio).toContain("AWS::EC2::VPC");
  });
});
