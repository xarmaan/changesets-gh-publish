import * as fs from "node:fs/promises";
import { getPackages, type Package } from "@manypkg/get-packages";

export async function getVersionsByDirectory(
  cwd: string,
): Promise<Map<string, string>> {
  const { packages } = await getPackages(cwd);
  return new Map(packages.map((x) => [x.dir, x.packageJson.version]));
}

export async function getChangedPackages(
  cwd: string,
  previousVersions: Map<string, string>,
): Promise<Package[]> {
  const { packages } = await getPackages(cwd);
  const changedPackages = new Set<Package>();

  for (const pkg of packages) {
    const previousVersion = previousVersions.get(pkg.dir);
    if (previousVersion !== pkg.packageJson.version) {
      changedPackages.add(pkg);
    }
  }

  return [...changedPackages];
}

export function sortTheThings(
  a: { private: boolean; highestLevel: number },
  b: { private: boolean; highestLevel: number },
): number {
  if (a.private === b.private) {
    return b.highestLevel - a.highestLevel;
  }
  if (a.private) {
    return 1;
  }
  return -1;
}

export function isErrorWithCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === code
  );
}

export function getGitHubRemoteUrl(
  githubToken: string,
  repository: string,
): string {
  const serverUrl = new URL(
    process.env["GITHUB_SERVER_URL"] || "https://github.com",
  );
  return `https://x-access-token:${githubToken}@${serverUrl.host}/${repository}.git`;
}

export function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath, fs.constants.F_OK).then(
    () => true,
    () => false,
  );
}
