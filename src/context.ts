import * as path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { Git } from "./git.ts";
import { type Octokit, setupOctokit } from "./octokit.ts";

export type CommitMode = "git-cli" | "github-api";

export type PrDraft = "create" | "always";

export type Inputs = {
  githubToken: string;
  setupGitUser: boolean;
  userName: string;
  userEmail: string;
  version: string | undefined;
  publish: string | undefined;
  cwd: string | undefined;
  commitMode: CommitMode;
  createGithubReleases: boolean;
  title: string;
  commit: string | undefined;
  branch: string;
  prDraft: PrDraft | undefined;
  externalRepository: string | undefined;
  externalToken: string;
  externalUserName: string;
  externalUserEmail: string;
};

export type ActionContextOptions = {
  cwd?: string;
  getInput?: (name: string) => string;
};

export class ActionContext {
  readonly inputs: Readonly<Inputs>;
  readonly cwd: string;
  readonly home: string;
  readonly octokit: Octokit;
  readonly git: Git;

  constructor({ getInput, cwd }: ActionContextOptions = {}) {
    this.inputs = getInputs(getInput);
    this.cwd = path.resolve(this.inputs.cwd ?? cwd ?? "");
    this.home = getHomeDir();
    this.octokit = setupOctokit(this.inputs.githubToken);
    this.git = new Git({
      octokit:
        this.inputs.commitMode === "github-api" ? this.octokit : undefined,
      cwd: this.cwd,
    });
  }
}

function getInputs(
  input: (name: string) => string = (name) => core.getInput(name)
): Inputs {
  // to maintain compatibility with workflows created before github_token input was introduced
  // it's important to prefer the explicitly set GITHUB_TOKEN over the default token coming from github.token
  const githubToken =
    process.env.GITHUB_TOKEN || optional(input("github_token"));
  if (!githubToken) {
    throw new Error("Please add the GITHUB_TOKEN to the changesets action");
  }

  const commitMode = optional(input("commit_mode")) ?? "git-cli";
  if (commitMode !== "git-cli" && commitMode !== "github-api") {
    throw new Error(`Invalid commit mode: ${commitMode}`);
  }

  const prDraft = optional(input("pr_draft"));
  if (prDraft !== undefined && prDraft !== "always" && prDraft !== "create") {
    throw new Error(`Invalid pr_draft: ${prDraft}`);
  }

  let userName = optional(input("user_name"));
  let userEmail = optional(input("user_email"));
  if (userName && !userEmail) {
    throw new Error('"user_email" must be provided together with "user_name"');
  }
  if (!userName && userEmail) {
    throw new Error('"user_name" must be provided together with "user_email"');
  }
  userName ||= "github-actions[bot]";
  userEmail ||= "41898282+github-actions[bot]@users.noreply.github.com";

  const publish = optional(input("publish"));

  const externalRepository = optional(input("external_repository"));
  if (externalRepository) {
    if (externalRepository.split("/").length !== 2) {
      throw new Error(`Invalid external repository: ${externalRepository}`);
    }
    if (publish !== "github") {
      throw new Error(
        `External repository can only be specified when "publish" is set to "github"`
      );
    }
  }

  let externalUserName = optional(input("user_name"));
  let externalUserEmail = optional(input("user_email"));
  if (externalUserName && !externalUserEmail) {
    throw new Error(
      '"external_user_email" must be provided together with "external_user_name"'
    );
  }
  if (!externalUserName && externalUserEmail) {
    throw new Error(
      '"external_user_name" must be provided together with "external_user_email"'
    );
  }
  externalUserName ||= userName;
  externalUserEmail ||= userEmail;

  return {
    githubToken,
    userName,
    userEmail,
    setupGitUser: boolean(input("setup_git_user"), true) ?? true,
    version: optional(input("version")),
    publish,
    cwd: optional(input("cwd")),
    commitMode,
    createGithubReleases:
      boolean(input("create_github_releases"), true) ?? true,
    title: optional(input("title")) ?? "Version Packages",
    commit: optional(input("commit")) ?? "Version Packages",
    prDraft,
    branch:
      optional(input("branch")) ??
      github.context.ref.replace("refs/heads/", ""),
    externalRepository,
    externalToken: optional(input("external_token")) ?? githubToken,
    externalUserName,
    externalUserEmail,
  };
}

function optional(value: string): string | undefined {
  return value || undefined;
}

function boolean(value: string): boolean;
function boolean(value: string, optional: true): boolean | undefined;
function boolean(value: string, optional: false): boolean;

function boolean(value: string, optional = false): boolean | undefined {
  if (!value) {
    return optional ? undefined : false;
  }
  return value.toLowerCase() === "true";
}

function getHomeDir(): string {
  return process.platform === "win32"
    ? process.env["USERPROFILE"] || "C:\\"
    : `${process.env.HOME}`;
}
