import { createRequire } from "node:module";
import { readPreState } from "@changesets/pre";
import readChangesets from "@changesets/read";
import type { NewChangeset, PreState } from "@changesets/types";
import { isErrorWithCode } from "./utils.ts";

const require = createRequire(import.meta.url);

export type ChangesetState = {
  preState: PreState | undefined;
  changesets: NewChangeset[];
};

export async function readChangesetState(cwd: string): Promise<ChangesetState> {
  const preState = await readPreState(cwd);
  const changesets = await readChangesets(cwd);

  if (preState !== undefined && preState.mode === "pre") {
    const changesetsToFilter = new Set(preState.changesets);

    return {
      preState,
      changesets: changesets.filter((x) => !changesetsToFilter.has(x.id)),
    };
  }

  return {
    preState: undefined,
    changesets,
  };
}

export function requireChangesetsCliPkgJson(cwd: string): {
  name: string;
  version: string;
} {
  try {
    return require(
      require.resolve("@changesets/cli/package.json", {
        paths: [cwd],
      }),
    );
  } catch (err) {
    if (isErrorWithCode(err, "MODULE_NOT_FOUND")) {
      throw new Error(
        `Have you forgotten to install \`@changesets/cli\` in "${cwd}"?`,
        { cause: err },
      );
    }
    throw err;
  }
}
