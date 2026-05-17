import fs from "node:fs/promises";
import { getPackages, type Package } from "@manypkg/get-packages";
import type { Root } from "mdast";
// @ts-ignore
import mdastToString from "mdast-util-to-string";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import unified from "unified";

export const BumpLevels = {
  dep: 0,
  patch: 1,
  minor: 2,
  major: 3,
} as const;

export async function getVersionsByDirectory(
  cwd: string
): Promise<Map<string, string>> {
  const { packages } = await getPackages(cwd);
  return new Map(packages.map((x) => [x.dir, x.packageJson.version]));
}

export async function getChangedPackages(
  cwd: string,
  previousVersions: Map<string, string>
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

type ChangelogEntry = {
  content: string;
  highestLevel: number;
};

export function getChangelogEntry(
  changelog: string,
  version: string
): ChangelogEntry | undefined {
  const ast = unified().use(remarkParse).parse(changelog) as Root;

  let highestLevel: number = BumpLevels.dep;

  const nodes = ast.children;
  let headingStartInfo: { index: number; depth: number } | undefined;
  let endIndex: number | undefined;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.type === "heading") {
      const stringified: string = mdastToString(node);
      const match = stringified.toLowerCase().match(/(major|minor|patch)/);
      if (match !== null) {
        const level = BumpLevels[match[0] as "major" | "minor" | "patch"];
        highestLevel = Math.max(level, highestLevel);
      }
      if (headingStartInfo === undefined && stringified === version) {
        headingStartInfo = {
          index: i,
          depth: node.depth,
        };
        continue;
      }
      if (
        endIndex === undefined &&
        headingStartInfo !== undefined &&
        headingStartInfo.depth === node.depth
      ) {
        endIndex = i;
        break;
      }
    }
  }

  if (!headingStartInfo) {
    return;
  }

  const tree: Root = {
    type: "root",
    children: ast.children.slice(headingStartInfo.index + 1, endIndex),
  };
  return {
    content: unified().use(remarkStringify).stringify(tree),
    highestLevel,
  };
}

export function sortTheThings(
  a: { private: boolean; highestLevel: number },
  b: { private: boolean; highestLevel: number }
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

export function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath, fs.constants.F_OK).then(
    () => true,
    () => false
  );
}
