import fs from "node:fs/promises";
import path from "node:path";
import type { Changeset } from "@changesets/types";
import writeChangeset from "@changesets/write";
import fixturez from "fixturez";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionContext } from "./context.ts";
import { runVersion } from "./version.ts";

vi.mock("@actions/github", () => ({
  context: {
    repo: {
      owner: "changesets",
      repo: "action",
    },
    ref: "refs/heads/some-branch",
    sha: "xeac7",
  },
  getOctokit: () => ({
    rest: mockedGithubMethods,
    graphql: mockedGraphql,
  }),
}));
vi.mock("./git.ts");
vi.mock("@changesets/ghcommit/git");

const mockedGithubMethods = {
  pulls: {
    create: vi.fn(),
    list: vi.fn(),
  },
  repos: {
    createRelease: vi.fn(),
  },
};
const mockedGraphql = vi.fn();

const f = fixturez(import.meta.dirname);

const linkNodeModules = async (cwd: string) => {
  await fs.symlink(
    path.join(import.meta.dirname, "..", "node_modules"),
    path.join(cwd, "node_modules")
  );
};
const writeChangesets = (changesets: Changeset[], cwd: string) => {
  return Promise.all(changesets.map((commit) => writeChangeset(commit, cwd)));
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("version", () => {
  it("creates simple PR", async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({ data: [] }));

    mockedGithubMethods.pulls.create.mockImplementationOnce(() => ({
      data: { number: 123 },
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
            {
              name: "changesets-dev-simple-project-pkg-b",
              type: "minor",
            },
          ],
          summary: "Awesome feature",
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx);

    expect(mockedGithubMethods.pulls.create.mock.calls[0]).toMatchSnapshot();
  });

  it('creates a draft PR when pr_draft is "create"', async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({ data: [] }));

    mockedGithubMethods.pulls.create.mockImplementationOnce(() => ({
      data: { number: 123 },
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
          ],
          summary: "Awesome feature",
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          case "pr_draft":
            return "create";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx);

    expect(mockedGithubMethods.pulls.create.mock.calls[0]).toMatchSnapshot();
  });

  it("only includes bumped packages in the PR body", async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({ data: [] }));

    mockedGithubMethods.pulls.create.mockImplementationOnce(() => ({
      data: { number: 123 },
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
          ],
          summary: "Awesome feature",
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx);

    expect(mockedGithubMethods.pulls.create.mock.calls[0]).toMatchSnapshot();
  });

  it("doesn't include ignored package that got a dependency update in the PR body", async () => {
    const cwd = f.copy("ignored-package");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({ data: [] }));

    mockedGithubMethods.pulls.create.mockImplementationOnce(() => ({
      data: { number: 123 },
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-ignored-package-pkg-b",
              type: "minor",
            },
          ],
          summary: "Awesome feature",
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx);

    expect(mockedGithubMethods.pulls.create.mock.calls[0]).toMatchSnapshot();
  });

  it("does not include changelog entries if full message exceeds size limit", async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({ data: [] }));

    mockedGithubMethods.pulls.create.mockImplementationOnce(() => ({
      data: { number: 123 },
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
          ],
          summary: `# Non manus superum

## Nec cornibus aequa numinis multo onerosior adde

Lorem markdownum undas consumpserat malas, nec est lupus; memorant gentisque ab
limine auctore. Eatque et promptu deficit, quam videtur aequa est **faciat**,
locus. Potentia deus habebat pia quam qui coniuge frater, tibi habent fertque
viribus. E et cognoscere arcus, lacus aut sic pro crimina fuit tum **auxilium**
dictis, qua, in.

In modo. Nomen illa membra.

> Corpora gratissima parens montibus tum coeperat qua remulus caelum Helenamque?
> Non poenae modulatur Amathunta in concita superi, procerum pariter rapto cornu
> munera. Perrhaebum parvo manus contingere, morari, spes per totiens ut
> dividite proculcat facit, visa.

Adspicit sequitur diffamatamque superi Phoebo qua quin lammina utque: per? Exit
decus aut hac inpia, seducta mirantia extremo. Vidi pedes vetus. Saturnius
fluminis divesque vulnere aquis parce lapsis rabie si visa fulmineis.
`,
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx, { prBodyMaxCharacters: 1000 });

    expect(mockedGithubMethods.pulls.create.mock.calls[0]).toMatchSnapshot();
    expect(mockedGithubMethods.pulls.create.mock.calls[0][0].body).toMatch(
      /The changelog information of each package has been omitted from this message/
    );
  });

  it("does not include any release information if a message with simplified release info exceeds size limit", async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({ data: [] }));

    mockedGithubMethods.pulls.create.mockImplementationOnce(() => ({
      data: { number: 123 },
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
          ],
          summary: `# Non manus superum

## Nec cornibus aequa numinis multo onerosior adde

Lorem markdownum undas consumpserat malas, nec est lupus; memorant gentisque ab
limine auctore. Eatque et promptu deficit, quam videtur aequa est **faciat**,
locus. Potentia deus habebat pia quam qui coniuge frater, tibi habent fertque
viribus. E et cognoscere arcus, lacus aut sic pro crimina fuit tum **auxilium**
dictis, qua, in.

In modo. Nomen illa membra.

> Corpora gratissima parens montibus tum coeperat qua remulus caelum Helenamque?
> Non poenae modulatur Amathunta in concita superi, procerum pariter rapto cornu
> munera. Perrhaebum parvo manus contingere, morari, spes per totiens ut
> dividite proculcat facit, visa.

Adspicit sequitur diffamatamque superi Phoebo qua quin lammina utque: per? Exit
decus aut hac inpia, seducta mirantia extremo. Vidi pedes vetus. Saturnius
fluminis divesque vulnere aquis parce lapsis rabie si visa fulmineis.
`,
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx, { prBodyMaxCharacters: 500 });

    expect(mockedGithubMethods.pulls.create.mock.calls[0]).toMatchSnapshot();
    expect(mockedGithubMethods.pulls.create.mock.calls[0][0].body).toMatch(
      /All release information have been omitted from this message, as the content exceeds the size limit/
    );
  });

  it('updates an existing PR via GraphQL without converting it to draft when pr_draft is "create"', async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({
      data: [{ number: 123, node_id: "PR_kwDOA" }],
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
          ],
          summary: "Awesome feature",
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          case "pr_draft":
            return "create";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx);

    expect(mockedGraphql.mock.calls[0]).toMatchSnapshot();
  });

  it('updates an existing PR via GraphQL and converts it to draft when pr_draft is "always"', async () => {
    const cwd = f.copy("simple-project");
    await linkNodeModules(cwd);

    mockedGithubMethods.pulls.list.mockImplementationOnce(() => ({
      data: [{ number: 123, node_id: "PR_kwDOA" }],
    }));

    await writeChangesets(
      [
        {
          releases: [
            {
              name: "changesets-dev-simple-project-pkg-a",
              type: "minor",
            },
          ],
          summary: "Awesome feature",
        },
      ],
      cwd
    );

    const ctx = new ActionContext({
      cwd,
      getInput: (name) => {
        switch (name) {
          case "github_token":
            return "@@GITHUB";
          case "pr_draft":
            return "always";
          default:
            return "";
        }
      },
    });

    await runVersion(ctx);

    expect(mockedGraphql.mock.calls[0]).toMatchSnapshot();
  });
});
