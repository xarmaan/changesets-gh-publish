import * as core from "@actions/core";
import { exec, getExecOutput } from "@actions/exec";
import * as github from "@actions/github";
import { commitChangesFromRepo } from "@changesets/ghcommit/git";
import { commitAll, setUser } from "./git-utils.ts";
import type { Octokit } from "./octokit.ts";

async function push(branch: string, cwd: string): Promise<void> {
  await exec("git", ["push", "origin", `HEAD:${branch}`, "--force"], { cwd });
}

async function switchToMaybeExistingBranch(
  branch: string,
  cwd: string
): Promise<void> {
  const { stderr } = await getExecOutput("git", ["checkout", branch], {
    ignoreReturnCode: true,
    cwd,
  });
  const isCreatingBranch = !stderr
    .toString()
    .includes(`Switched to a new branch '${branch}'`);
  if (isCreatingBranch) {
    await exec("git", ["checkout", "-b", branch], { cwd });
  }
}

async function reset(pathSpec: string, cwd: string): Promise<void> {
  await exec("git", ["reset", `--hard`, pathSpec], { cwd });
}

async function checkIfClean(cwd: string): Promise<boolean> {
  const { stdout } = await getExecOutput("git", ["status", "--porcelain"], {
    cwd,
  });
  return !stdout.length;
}

export class Git {
  private octokit: Octokit | null;
  private cwd: string;

  constructor({ octokit, cwd }: { octokit?: Octokit; cwd: string }) {
    this.octokit = octokit ?? null;
    this.cwd = cwd;
  }

  async setupUser(name: string, email: string): Promise<void> {
    if (this.octokit) {
      return;
    }

    await setUser(name, email, this.cwd);
  }

  async pushTag(tag: string): Promise<void> {
    if (this.octokit) {
      await this.octokit.rest.git
        .createRef({
          ...github.context.repo,
          ref: `refs/tags/${tag}`,
          sha: github.context.sha,
        })
        .catch((err) => {
          // Assuming tag was manually pushed in custom publish script
          core.warning(`[WARN] Failed to create tag ${tag}: ${err.message}`);
        });
      return;
    }

    await exec("git", ["push", "origin", tag], { cwd: this.cwd });
  }

  async prepareBranch(branch: string): Promise<void> {
    if (this.octokit) {
      // Preparing a new local branch is not necessary when using the API
      return;
    }

    await switchToMaybeExistingBranch(branch, this.cwd);
    await reset(github.context.sha, this.cwd);
  }

  async pushChanges({
    branch,
    message,
  }: {
    branch: string;
    message: string;
  }): Promise<void> {
    if (this.octokit) {
      /**
       * Only add files form the current working directory
       *
       * This will emulate the behavior of `git add .`,
       * used in {@link commitAll}.
       */
      await commitChangesFromRepo({
        ...github.context.repo,
        octokit: this.octokit,
        branch,
        message,
        base: {
          commit: github.context.sha,
        },
        cwd: this.cwd,
        force: true,
      });
      return;
    }

    if (!(await checkIfClean(this.cwd))) {
      await commitAll(message, this.cwd);
    }
    await push(branch, this.cwd);
  }
}
