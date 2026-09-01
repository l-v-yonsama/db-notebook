import {
  AwsDatabase,
  AwsServiceType,
  DbResource,
  DbSESIdentity,
  ResourceType,
} from "@l-v-yonsama/multi-platform-database-drivers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendDashboardContextValues,
  stampDashboardConnectionName,
} from "../../src/observability/dashboardLaunch";

class TestResource extends DbResource {
  constructor(name: string) {
    super(ResourceType.Group, name);
  }
}

describe("dashboard launch", () => {
  it("adds valid dashboard tokens once and leaves the final tag anchor to the caller", () => {
    const resource = new TestResource("queue");
    resource.capabilities = {
      dashboards: [
        { dashboardId: "aws-cloudwatch-metrics", providerId: "aws.sqs.queue" },
        { dashboardId: "aws-cloudwatch-metrics", providerId: "duplicate.fixture" },
        { dashboardId: "Invalid ID", providerId: "invalid.fixture" },
      ],
    };

    const contextValue = `${appendDashboardContextValues(
      "Queue,properties",
      resource
    )},tag:dbResource`;

    expect(contextValue).toBe("Queue,properties,dashboard:aws-cloudwatch-metrics,tag:dbResource");
    expect(contextValue).toMatch(/,dashboard:aws-cloudwatch-metrics,/);
  });

  it("recursively stamps conName only on dashboard-capable resources", () => {
    const root = new TestResource("root");
    root.meta = { keep: "root" };
    const group = root.addChild(new TestResource("future service group"));
    group.meta = { keep: "group" };
    const target = group.addChild(new TestResource("future service target"));
    target.meta = { keep: "target" };
    target.capabilities = {
      dashboards: [{ dashboardId: "aws-cloudwatch-metrics", providerId: "aws.future.resource" }],
    };

    stampDashboardConnectionName(root, "development");

    expect(root.meta).toEqual({ keep: "root" });
    expect(group.meta).toEqual({ keep: "group" });
    expect(target.meta).toEqual({ keep: "target", conName: "development" });
  });

  it("adds the dashboard menu to the SES service node but not its identities", () => {
    const service = new AwsDatabase("SES", AwsServiceType.SES);
    const identity = new DbSESIdentity("sender@example.com", {
      identityType: "EmailAddress",
      verificationStatus: "Success",
    });

    expect(appendDashboardContextValues("AwsDatabase", service)).toContain(
      ",dashboard:aws-cloudwatch-metrics"
    );
    expect(appendDashboardContextValues("Identity", identity)).toBe("Identity");
  });

  it("adds the explicit overview dashboard only to supported service nodes", () => {
    const sqs = new AwsDatabase("SQS", AwsServiceType.SQS);
    const dynamodb = new AwsDatabase("DynamoDB", AwsServiceType.DynamoDB);
    const s3 = new AwsDatabase("S3", AwsServiceType.S3);

    expect(appendDashboardContextValues("AwsDatabase", sqs)).toContain(
      ",dashboard:aws-cloudwatch-metrics-overview"
    );
    expect(appendDashboardContextValues("AwsDatabase", dynamodb)).toContain(
      ",dashboard:aws-cloudwatch-metrics-overview"
    );
    expect(appendDashboardContextValues("AwsDatabase", s3)).toContain(
      ",dashboard:aws-cloudwatch-metrics-overview"
    );
  });

  it("registers one exact context-menu token match for the CloudWatch dashboard", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      contributes: {
        menus: Record<
          string,
          Array<{ command?: string; when?: string; group?: string }>
        >;
      };
    };
    const menuItems = manifest.contributes.menus["view/item/context"].filter(
      (item) => item.command === "database-notebook.show-cloudwatch-metrics"
    );

    expect(menuItems).toEqual([
      {
        command: "database-notebook.show-cloudwatch-metrics",
        when: "view == database-notebook-connections && viewItem =~ /,dashboard:aws-cloudwatch-metrics,/",
        group: "db-resourc@4",
      },
    ]);
  });

  it("registers a separate exact context-menu command for service overviews", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      contributes: {
        menus: Record<
          string,
          Array<{ command?: string; when?: string; group?: string }>
        >;
      };
    };
    const menuItems = manifest.contributes.menus["view/item/context"].filter(
      (item) => item.command === "database-notebook.show-cloudwatch-metrics-overview"
    );

    expect(menuItems).toEqual([
      {
        command: "database-notebook.show-cloudwatch-metrics-overview",
        when: "view == database-notebook-connections && viewItem =~ /,dashboard:aws-cloudwatch-metrics-overview,/",
        group: "db-resourc@4",
      },
    ]);
  });
});
