import { readPreState } from "@changesets/pre";
import readChangesets from "@changesets/read";
import type { NewChangeset, PreState } from "@changesets/types";

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
