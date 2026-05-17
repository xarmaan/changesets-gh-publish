import * as path from "node:path";
import { getExecOutput } from "@actions/exec";
import { fileExists } from "./utils.ts";

export async function packPackage(
  pm: "npm" | "pnpm",
  pkgDir: string,
  destDir: string,
): Promise<string> {
  const { stdout } = await getExecOutput(
    pm,
    ["pack", "--json", "--pack-destination", path.resolve(destDir)],
    {
      cwd: pkgDir,
    },
  );

  const output = JSON.parse(stdout) as
    | { filename?: string }
    | { filename?: string }[];

  const filename = Array.isArray(output)
    ? output[0]?.filename
    : output?.filename;

  if (typeof filename !== "string") {
    throw new Error(`Failed to create package tarball for ${pkgDir}`);
  }

  const file = path.resolve(destDir, filename);

  const exists = await fileExists(file);
  if (!exists) {
    throw new Error(`Packed tarball not found: ${file}`);
  }

  return file;
}
