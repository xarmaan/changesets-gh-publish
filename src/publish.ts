import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import * as github from "@actions/github";
import * as io from "@actions/io";
import { getPackages, type Package } from "@manypkg/get-packages";
import { packlist } from "@pnpm/fs.packlist";
import { type DetectResult, detect } from "package-manager-detector";
import * as tar from "tar";
import type { ActionContext } from "./context.ts";
import { remoteHeadExists, remoteTagList, setUser } from "./git-utils.ts";
import { type Octokit, setupOctokit } from "./octokit.ts";
import { fileExists, getChangelogEntry, isErrorWithCode } from "./utils.ts";

async function createRelease(
  octokit: Octokit,
  {
    pkg,
    tagName,
    owner,
    repo,
  }: { pkg: Package; tagName: string; owner: string; repo: string }
): Promise<void> {
  let changelog: string;
  try {
    changelog = await fs.readFile(path.join(pkg.dir, "CHANGELOG.md"), "utf8");
  } catch (err) {
    if (isErrorWithCode(err, "ENOENT")) {
      // if we can't find a changelog, the user has probably disabled changelogs
      return;
    }
    throw err;
  }

  const changelogEntry = getChangelogEntry(changelog, pkg.packageJson.version);
  if (!changelogEntry) {
    // we can find a changelog but not the entry for this version
    // if this is true, something has probably gone wrong
    throw new Error(
      `Could not find changelog entry for ${pkg.packageJson.name}@${pkg.packageJson.version}`
    );
  }

  await octokit.rest.repos.createRelease({
    owner,
    repo,
    name: tagName,
    tag_name: tagName,
    body: changelogEntry.content,
    prerelease: pkg.packageJson.version.includes("-"),
  });
}

type PublishedPackage = { name: string; version: string };

type PublishResult =
  | {
      published: true;
      publishedPackages: PublishedPackage[];
    }
  | {
      published: false;
    };

export async function runScriptPublish(
  script: string,
  ctx: ActionContext
): Promise<PublishResult> {
  const [publishCommand, ...publishArgs] = script.split(/\s+/);

  const changesetPublishOutput = await getExecOutput(
    publishCommand,
    publishArgs,
    {
      cwd: ctx.cwd,
      env: { ...process.env, GITHUB_TOKEN: ctx.inputs.githubToken },
    }
  );

  const { packages, tool } = await getPackages(ctx.cwd);
  const releasedPackages: Package[] = [];

  if (tool !== "root") {
    const newTagRegex = /New tag:\s+(@[^/]+\/[^@]+|[^/]+)@([^\s]+)/;
    const packagesByName = new Map(
      packages.map((x) => [x.packageJson.name, x])
    );

    for (const line of changesetPublishOutput.stdout.split("\n")) {
      const match = line.match(newTagRegex);
      if (match === null) {
        continue;
      }
      const pkgName = match[1];
      const pkg = packagesByName.get(pkgName);
      if (pkg === undefined) {
        throw new Error(
          `Package "${pkgName}" not found.` +
            "This is probably a bug in the action, please open an issue"
        );
      }
      releasedPackages.push(pkg);
    }

    if (ctx.inputs.createGithubReleases) {
      await Promise.all(
        releasedPackages.map(async (pkg) => {
          const tagName = `${pkg.packageJson.name}@${pkg.packageJson.version}`;
          await ctx.git.pushTag(tagName);
          await createRelease(ctx.octokit, {
            ...github.context.repo,
            pkg,
            tagName,
          });
        })
      );
    }
  } else {
    if (packages.length === 0) {
      throw new Error(
        `No package found.` +
          "This is probably a bug in the action, please open an issue"
      );
    }
    const pkg = packages[0];
    const newTagRegex = /New tag:/;

    for (const line of changesetPublishOutput.stdout.split("\n")) {
      const match = line.match(newTagRegex);

      if (match) {
        releasedPackages.push(pkg);
        if (ctx.inputs.createGithubReleases) {
          const tagName = `v${pkg.packageJson.version}`;
          await ctx.git.pushTag(tagName);
          await createRelease(ctx.octokit, {
            ...github.context.repo,
            pkg,
            tagName,
          });
        }
        break;
      }
    }
  }

  if (releasedPackages.length) {
    return {
      published: true,
      publishedPackages: releasedPackages.map((pkg) => ({
        name: pkg.packageJson.name,
        version: pkg.packageJson.version,
      })),
    };
  }

  return { published: false };
}

export async function runGitHubPublish(
  ctx: ActionContext
): Promise<PublishResult> {
  let pm: DetectResult | null = null;

  try {
    pm = await detect({ cwd: ctx.cwd });
  } catch (_) {}

  if (!pm) {
    core.warning("[WARN] could not detect package manager");
  } else if (pm.agent === "pnpm" || pm.agent === "npm") {
    core.info(`[INFO] detected package manager: ${pm.agent}`);
  } else {
    core.warning(`[WARN] detected unsupported package manager: ${pm.agent}`);
  }

  const workDir = path.resolve(
    ctx.home,
    `changesets-gh-publish-action-${Date.now()}`
  );
  const gitDir = path.resolve(workDir, "git");
  const packsDir = path.resolve(workDir, "packs");

  const [repositoryOwner, repositoryRepo] = ctx.inputs.externalRepository
    ? ctx.inputs.externalRepository.split("/")
    : [github.context.repo.owner, github.context.repo.repo];
  const repository = `${repositoryOwner}/${repositoryRepo}`;
  const userName = ctx.inputs.externalRepository
    ? ctx.inputs.externalUserName
    : ctx.inputs.userName;
  const userEmail = ctx.inputs.externalRepository
    ? ctx.inputs.externalUserEmail
    : ctx.inputs.userEmail;
  const githubToken = ctx.inputs.externalRepository
    ? ctx.inputs.externalToken
    : ctx.inputs.githubToken;

  const remoteUrl = getGitHubRemoteUrl(githubToken, repository);

  const octokit = setupOctokit(githubToken);

  await io.mkdirP(gitDir);
  await io.mkdirP(packsDir);

  core.info(`[INFO] created temp directory: ${workDir}`);

  try {
    await exec("git", ["init"], { cwd: gitDir });
    await exec("git", ["remote", "add", "origin", remoteUrl], { cwd: gitDir });
    await setUser(userName, userEmail, gitDir);

    const { packages, tool } = await getPackages(ctx.cwd);

    if (packages.length === 0) {
      if (tool === "root") {
        throw new Error(
          `No package found.` +
            "This is probably a bug in the action, please open an issue"
        );
      } else {
        return { published: false };
      }
    }

    await Promise.all(
      packages.map(async (pkg) => {
        const tag =
          tool !== "root"
            ? `${pkg.packageJson.name}@${pkg.packageJson.version}`
            : `v${pkg.packageJson.version}`;
        const checkTagCode = await exec(
          "git",
          ["check-ref-format", `refs/tags/${tag}`],
          {
            cwd: gitDir,
            ignoreReturnCode: true,
          }
        );
        if (checkTagCode !== 0) {
          throw new Error(
            `Invalid Git tag name "${tag}" generated from package "${pkg.packageJson.name}".`
          );
        }
      })
    );

    const repoFound =
      (await remoteHeadExists(gitDir)) ||
      (await octokit.rest.repos
        .get({
          owner: repositoryOwner,
          repo: repositoryRepo,
        })
        .catch((err) => {
          if (err?.status === 404 || err?.status === 403) {
            return false;
          }
          throw err;
        }));
    if (!repoFound) {
      throw new Error(
        `Repository ${repository} does not exist or is inaccessible.`
      );
    }
    core.info(`[INFO] repository accessible: ${repository}`);

    const remoteTags = await remoteTagList(gitDir);

    const packagesInfo = await Promise.all(
      packages.map<Promise<Package & { tag: string; published: boolean }>>(
        async (pkg) => {
          const tag =
            tool !== "root"
              ? `${pkg.packageJson.name}@${pkg.packageJson.version}`
              : `v${pkg.packageJson.version}`;
          return {
            ...pkg,
            tag,
            published: remoteTags.has(tag),
          };
        }
      )
    );

    const packagesToPublish = packagesInfo.filter((pkg) => !pkg.published);

    if (packagesToPublish.length === 0) {
      return { published: false };
    }

    for (const pkg of packagesToPublish) {
      await exec("git", ["checkout", "--orphan", `temp/${pkg.tag}`], {
        cwd: gitDir,
      });
      await exec("git", ["clean", "-fdx"], { cwd: gitDir });

      if (pm?.agent === "pnpm" || pm?.agent === "npm") {
        const tarball = await packPackage(pm.agent, pkg.dir, packsDir);
        await tar.x({
          file: tarball,
          cwd: gitDir,
          strip: 1,
        });
      } else {
        const files = await packlist(pkg.dir);

        await Promise.all(
          files.map(async (file) => {
            const src = path.join(pkg.dir, file);
            const dest = path.join(gitDir, file);
            await io.mkdirP(path.dirname(dest));
            await fs.copyFile(src, dest);
          })
        );
      }

      await exec("git", ["add", "."], {
        cwd: gitDir,
      });

      await exec("git", ["commit", "--allow-empty", "--message", pkg.tag], {
        cwd: gitDir,
      });

      await exec("git", ["tag", "--annotate", pkg.tag, "--message", pkg.tag], {
        cwd: gitDir,
      });
    }

    await exec(
      "git",
      ["push", "origin", ...packagesToPublish.map((pkg) => pkg.tag)],
      { cwd: gitDir }
    );

    if (ctx.inputs.createGithubReleases) {
      await Promise.all(
        packagesToPublish.map(async (pkg) => {
          return createRelease(octokit, {
            owner: repositoryOwner,
            repo: repositoryRepo,
            pkg,
            tagName: pkg.tag,
          });
        })
      );
    }

    return {
      published: true,
      publishedPackages: packagesToPublish.map((pkg) => ({
        name: pkg.packageJson.name,
        version: pkg.packageJson.version,
      })),
    };
  } finally {
    await io.rmRF(gitDir);
  }

  return { published: false };
}

function getGitHubRemoteUrl(githubToken: string, repository: string): string {
  const serverUrl = new URL(
    process.env["GITHUB_SERVER_URL"] || "https://github.com"
  );
  return `https://x-access-token:${githubToken}@${serverUrl.host}/${repository}.git`;
}

async function packPackage(
  pm: "npm" | "pnpm",
  pkgDir: string,
  destDir: string
): Promise<string> {
  const { stdout } = await getExecOutput(
    pm,
    ["pack", "--json", "--pack-destination", destDir],
    {
      cwd: pkgDir,
    }
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

  if (!(await fileExists(file))) {
    throw new Error(`Packed tarball not found: ${file}`);
  }

  return file;
}
