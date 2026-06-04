import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import * as github from "@actions/github";
import type { PreState } from "@changesets/types";
import semverLt from "semver/functions/lt.js";
import { BumpLevels, getChangelogEntry } from "./changelog.ts";
import {
  readChangesetState,
  requireChangesetsCliPkgJson,
} from "./changeset.ts";
import { MAX_CHARACTERS_PER_MESSAGE } from "./constants.ts";
import type { ActionContext } from "./context.ts";
import {
  getChangedPackages,
  getVersionsByDirectory,
  sortTheThings,
} from "./utils.ts";

type GetMessageOptions = {
  publishScript: string | undefined;
  branch: string;
  changedPackagesInfo: {
    highestLevel: number;
    private: boolean;
    content: string;
    header: string;
  }[];
  prBodyMaxCharacters: number;
  preState?: PreState;
};

export async function getVersionPrBody({
  publishScript,
  preState,
  changedPackagesInfo,
  prBodyMaxCharacters,
  branch,
}: GetMessageOptions): Promise<string> {
  const messageHeader = `This PR was opened by the [Changesets release](https://github.com/changesets/action) GitHub action. When you're ready to do a release, you can merge this and ${
    publishScript === "github"
      ? "the packages will be published to GitHub Releases automatically"
      : publishScript
        ? `the packages will be published to npm automatically`
        : `publish to npm yourself or [setup this action to publish automatically](https://github.com/changesets/action#with-publishing)`
  }. If you're not ready to do a release yet, that's fine, whenever you add more changesets to ${branch}, this PR will be updated.
`;
  const messagePrestate = !!preState
    ? `⚠️⚠️⚠️⚠️⚠️⚠️

\`${branch}\` is currently in **pre mode** so this branch has prereleases rather than normal releases. If you want to exit prereleases, run \`changeset pre exit\` on \`${branch}\`.

⚠️⚠️⚠️⚠️⚠️⚠️
`
    : "";
  const messageReleasesHeading = `# Releases`;

  let fullMessage = [
    messageHeader,
    messagePrestate,
    messageReleasesHeading,
    ...changedPackagesInfo.map((info) => `${info.header}\n\n${info.content}`),
  ].join("\n");

  // Check that the message does not exceed the size limit.
  // If not, omit the changelog entries of each package.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      `\n> The changelog information of each package has been omitted from this message, as the content exceeds the size limit.\n`,
      ...changedPackagesInfo.map((info) => `${info.header}\n\n`),
    ].join("\n");
  }

  // Check (again) that the message is within the size limit.
  // If not, omit all release content this time.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      `\n> All release information have been omitted from this message, as the content exceeds the size limit.`,
    ].join("\n");
  }

  return fullMessage;
}

type RunVersionResult = {
  pullRequestNumber: number;
};

export async function runVersion(
  ctx: ActionContext,
  {
    script,
    publishScript,
    prBodyMaxCharacters = MAX_CHARACTERS_PER_MESSAGE,
  }: {
    script?: string;
    publishScript?: string;
    prBodyMaxCharacters?: number;
  } = {},
): Promise<RunVersionResult> {
  const versionBranch = `changeset-release/${ctx.inputs.branch}`;

  const { preState } = await readChangesetState(ctx.cwd);

  await ctx.git.prepareBranch(versionBranch);

  const versionsByDirectory = await getVersionsByDirectory(ctx.cwd);

  const env = { ...process.env, GITHUB_TOKEN: ctx.inputs.githubToken };

  if (script) {
    await exec(script, undefined, { cwd: ctx.cwd, env });
  } else {
    const changesetsCliPkgJson = requireChangesetsCliPkgJson(ctx.cwd);
    const cmd = semverLt(changesetsCliPkgJson.version, "2.0.0")
      ? "bump"
      : "version";
    await exec(
      "node",
      [
        require.resolve("@changesets/cli/bin.js", {
          paths: [ctx.cwd],
        }),
        cmd,
      ],
      {
        cwd: ctx.cwd,
        env,
      },
    );
  }

  const changedPackages = await getChangedPackages(
    ctx.cwd,
    versionsByDirectory,
  );
  const changedPackagesInfoPromises = Promise.all(
    changedPackages.map(async (pkg) => {
      const changelogContents = await fs.readFile(
        path.join(pkg.dir, "CHANGELOG.md"),
        "utf8",
      );

      const entry = getChangelogEntry(
        changelogContents,
        pkg.packageJson.version,
      );
      return {
        highestLevel: entry?.highestLevel ?? BumpLevels.dep,
        private: !!pkg.packageJson.private,
        content: entry?.content ?? "",
        header: `## ${pkg.packageJson.name}@${pkg.packageJson.version}`,
      };
    }),
  );

  const finalPrTitle = `${ctx.inputs.title}${
    !!preState ? ` (${preState.tag})` : ""
  }`;
  const finalCommitMessage = `${ctx.inputs.commit}${
    !!preState ? ` (${preState.tag})` : ""
  }`;

  /**
   * Fetch any existing pull requests that are open against the branch,
   * before we push any changes that may inadvertently close the existing PRs.
   *
   * (`@changesets/ghcommit` has to reset the branch to the same commit as the base,
   * which GitHub will then react to by closing the PRs)
   */
  const existingPullRequests = await ctx.octokit.rest.pulls.list({
    ...github.context.repo,
    state: "open",
    head: `${github.context.repo.owner}:${versionBranch}`,
    base: ctx.inputs.branch,
  });
  core.startGroup("Existing pull requests");
  for (const data of existingPullRequests.data) {
    core.info(JSON.stringify(data, null, 2));
  }
  core.endGroup();

  await ctx.git.pushChanges({
    branch: versionBranch,
    message: finalCommitMessage,
  });

  const changedPackagesInfo = (await changedPackagesInfoPromises)
    .filter((x) => x)
    .sort(sortTheThings);

  const prBody = await getVersionPrBody({
    publishScript,
    preState,
    branch: ctx.inputs.branch,
    changedPackagesInfo,
    prBodyMaxCharacters,
  });

  if (existingPullRequests.data.length === 0) {
    core.info("[INFO] creating pull request");
    const { data: newPullRequest } = await ctx.octokit.rest.pulls.create({
      base: ctx.inputs.branch,
      head: versionBranch,
      title: finalPrTitle,
      body: prBody,
      draft: ctx.inputs.prDraft !== undefined,
      ...github.context.repo,
    });

    return {
      pullRequestNumber: newPullRequest.number,
    };
  } else {
    const [pullRequest] = existingPullRequests.data;

    core.info(`[INFO] updating found pull request #${pullRequest.number}`);
    const convertPullRequestToDraftMutation =
      ctx.inputs.prDraft === "always"
        ? `
        convertPullRequestToDraft(
          input: {
            pullRequestId: $pullRequestId
          }
        ) {
          pullRequest {
            id
          }
        }`
        : "";
    const updatePullRequestMutation = `
      mutation UpdatePullRequest(
        $pullRequestId: ID!
        $title: String!
        $body: String!
      ) {
        ${convertPullRequestToDraftMutation}

        updatePullRequest(
          input: {
            pullRequestId: $pullRequestId
            title: $title
            body: $body
            state: OPEN
          }
        ) {
          pullRequest {
            id
          }
        }
      }
    `;

    await ctx.octokit.graphql(updatePullRequestMutation, {
      pullRequestId: pullRequest.node_id,
      title: finalPrTitle,
      body: prBody,
    });

    return {
      pullRequestNumber: pullRequest.number,
    };
  }
}
