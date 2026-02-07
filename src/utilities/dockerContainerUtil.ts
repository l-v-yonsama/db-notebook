import { DBType } from "@l-v-yonsama/multi-platform-database-drivers";
import execa from "execa";
import { DockerContainerSummary } from "../types/Docker";

export function buildDockerContainerItems(
  containers: DockerContainerSummary[],
  dbType: DBType
): { label: string; value: string }[] {
  const keywords = getDbTypeKeywords(dbType);

  return [...containers]
    .sort((a, b) => {
      const sa = scoreDockerContainer(a, keywords);
      const sb = scoreDockerContainer(b, keywords);
      return sb - sa;
    })
    .map((it) => ({
      label: `${it.name} (${it.image})`,
      value: it.name,
    }));
}

export async function listRunningDockerContainers(): Promise<DockerContainerSummary[]> {
  const { stdout } = await execa("docker", [
    "ps",
    "--format",
    "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
  ]);

  if (!stdout.trim()) {
    return [];
  }

  return stdout.split("\n").map((line) => {
    const [id, name, image, status] = line.split("\t");
    return { id, name, image, status };
  });
}

export function scoreDockerContainer(
  container: DockerContainerSummary,
  keywords: string[]
): number {
  const haystack = `${container.name} ${container.image}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw)) ? 1 : 0;
}

export function getDbTypeKeywords(dbType: DBType): string[] {
  switch (dbType) {
    case "MySQL":
      return ["mysql", "mariadb"];
    case "Postgres":
      return ["postgres", "postgresql"];
    default:
      return [];
  }
}
