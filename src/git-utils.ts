import { exec, getExecOutput } from "@actions/exec";

export async function setUser(
  name: string,
  email: string,
  cwd: string,
): Promise<void> {
  await exec("git", ["config", "user.name", name], {
    cwd,
  });
  await exec("git", ["config", "user.email", email], {
    cwd,
  });
}

export async function commitAll(message: string, cwd: string): Promise<void> {
  await exec("git", ["add", "."], { cwd });
  await exec("git", ["commit", "-m", message], { cwd });
}

export async function remoteHeadExists(cwd: string): Promise<boolean> {
  const exitCode = await exec(
    "git",
    ["ls-remote", "--exit-code", "origin", "HEAD"],
    {
      cwd,
      ignoreReturnCode: true,
    },
  );
  return exitCode === 0;
}

export async function remoteBranchExists(
  branch: string,
  cwd: string,
): Promise<boolean> {
  const exitCode = await exec(
    "git",
    ["ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${branch}`],
    {
      cwd,
      ignoreReturnCode: true,
    },
  );
  return exitCode === 0;
}

export async function remoteTagList(cwd: string): Promise<Map<string, string>> {
  const regex = /^([a-f0-9]+)\s+refs\/tags\/(.+?)(\^\{\})?$/;
  const map = new Map();
  const { exitCode, stdout } = await getExecOutput(
    "git",
    ["ls-remote", "--exit-code", "--tags", "origin"],
    {
      cwd,
      ignoreReturnCode: true,
    },
  );
  if (exitCode !== 0) {
    return map;
  }
  const lines = stdout.trim().split("\n");
  for (const line of lines) {
    const match = line.match(regex);
    if (!match) continue;

    const [, hash, name, peeled] = match;
    if (peeled || !map.has(name)) {
      map.set(name, hash);
    }
  }
  return map;
}

export async function remoteTagExists(
  tag: string,
  cwd: string,
): Promise<boolean> {
  const exitCode = await exec(
    "git",
    ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
    {
      cwd,
      ignoreReturnCode: true,
    },
  );
  return exitCode === 0;
}
