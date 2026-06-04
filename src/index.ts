import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as core from "@actions/core";
import { readChangesetState } from "./changeset.ts";
import { ActionContext } from "./context.ts";
import { runGitHubPublish, runScriptPublish } from "./publish.ts";
import { fileExists } from "./utils.ts";
import { runVersion } from "./version.ts";

(async () => {
  const ctx = new ActionContext();

  core.info(`[INFO] using resolved cwd: ${ctx.cwd}`);

  if (ctx.inputs.setupGitUser) {
    core.info(
      `[INFO] setting git user: ${ctx.inputs.userName} <${ctx.inputs.userEmail}>`,
    );
    await ctx.git.setupUser(ctx.inputs.userName, ctx.inputs.userEmail);
  }

  core.info("[INFO] setting GitHub credentials");
  await fs.writeFile(
    path.resolve(ctx.home, ".netrc"),
    `machine github.com\nlogin ${ctx.inputs.userEmail}\npassword ${ctx.inputs.githubToken}`,
  );

  const { changesets } = await readChangesetState(ctx.cwd);

  const publishScript = ctx.inputs.publish ?? "";
  const hasChangesets = changesets.length !== 0;
  const hasNonEmptyChangesets = changesets.some(
    (changeset) => changeset.releases.length > 0,
  );
  const hasPublishScript = !!publishScript && publishScript !== "github";

  core.setOutput("published", "false");
  core.setOutput("published_packages", "[]");
  core.setOutput("has_changesets", String(hasChangesets));

  switch (true) {
    case !hasChangesets && publishScript === "github": {
      core.info(
        "[INFO] No changesets found. Attempting to publish any unpublished packages to GitHub",
      );

      await runGitHubPublish(ctx);

      return;
    }
    case !hasChangesets && !hasPublishScript: {
      core.info(
        "[INFO] No changesets present or were removed by merging release PR. Not publishing because no publish script found.",
      );
      return;
    }
    case !hasChangesets && hasPublishScript: {
      core.info(
        "[INFO] No changesets found. Attempting to publish any unpublished packages to npm",
      );

      if (process.env.NPM_TOKEN) {
        const userNpmrcPath = path.resolve(ctx.home, ".npmrc");

        if (await fileExists(userNpmrcPath)) {
          core.info("[INFO] Found existing user .npmrc file");
          const userNpmrcContent = await fs.readFile(userNpmrcPath, "utf8");
          const authLine = userNpmrcContent.split("\n").find((line) => {
            // check based on https://github.com/npm/cli/blob/8f8f71e4dd5ee66b3b17888faad5a7bf6c657eed/test/lib/adduser.js#L103-L105
            return /^\s*\/\/registry\.npmjs\.org\/:[_-]authToken=/i.test(line);
          });
          if (authLine) {
            core.info(
              "[INFO] Found existing auth token for the npm registry in the user .npmrc file",
            );
          } else {
            core.info(
              "[INFO] Didn't find existing auth token for the npm registry in the user .npmrc file, creating one",
            );
            await fs.appendFile(
              userNpmrcPath,
              `\n//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`,
            );
          }
        } else {
          core.info(
            "[INFO] No user .npmrc file found, creating one with NPM_TOKEN used as auth token",
          );
          await fs.writeFile(
            userNpmrcPath,
            `//registry.npmjs.org/:_authToken=${process.env.NPM_TOKEN}\n`,
          );
        }
      } else if (
        process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN &&
        process.env.ACTIONS_ID_TOKEN_REQUEST_URL
      ) {
        core.info(
          "[INFO] No NPM_TOKEN found, but OIDC is available - using npm trusted publishing",
        );
      } else {
        core.info(
          "[INFO] No NPM_TOKEN or OIDC available - assuming npm is already authenticated",
        );
      }

      const result = await runScriptPublish(publishScript, ctx);

      if (result.published) {
        core.setOutput("published", "true");
        core.setOutput(
          "published_packages",
          JSON.stringify(result.publishedPackages),
        );
      }

      if (result.exitCode !== 0) {
        core.error(
          `Publish command exited with code ${result.exitCode}${
            result.published
              ? `, but some packages were published: ${result.publishedPackages
                  .map((p) => `${p.name}@${p.version}`)
                  .join(", ")}`
              : ""
          }`,
        );
        process.exit(result.exitCode);
      }
      return;
    }
    case hasChangesets && !hasNonEmptyChangesets: {
      core.info("[INFO] All changesets are empty; not creating PR");

      return;
    }
    case hasChangesets: {
      const { pullRequestNumber } = await runVersion(ctx, {
        script: ctx.inputs.version,
        publishScript,
      });

      core.setOutput("pull_request_number", String(pullRequestNumber));

      return;
    }
  }
})().catch((err) => {
  core.error(err);
  core.setFailed(err.message);
});
