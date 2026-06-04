export const BumpLevels = {
  dep: 0,
  patch: 1,
  minor: 2,
  major: 3,
} as const;

export type ChangelogEntry = {
  content: string;
  highestLevel: number;
};

export function getChangelogEntry(
  changelog: string,
  version: string,
): ChangelogEntry | undefined {
  let highestLevel: number = BumpLevels.dep;
  let headingStartInfo: { index: number; depth: number } | undefined;
  let endIndex: number | undefined;

  // Iterate through each headings and code blocks (for skipping its contents)
  const regex = /^(#{1,6})\s(.*)$|^(`{3,})/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(changelog)) != null) {
    // Skip over code blocks so we don't match any headings inside of them
    if (match[3]) {
      const endOfCodeBlockRegex = new RegExp(`^${match[3]}`, "gm");
      endOfCodeBlockRegex.lastIndex = regex.lastIndex;
      const endMatch = endOfCodeBlockRegex.exec(changelog);
      if (endMatch) {
        // Start next search for headings after the end of the code block
        regex.lastIndex = endOfCodeBlockRegex.lastIndex;
        continue;
      } else {
        // Can't find end of code block, probably malformed
        break;
      }
    }

    const headingDepth = match[1].length;
    const headingText = match[2].trim();

    // Search for the highest bump level in the entire changelog
    const levelMatch = /(major|minor|patch)/.exec(headingText.toLowerCase());
    if (levelMatch != null) {
      const level = BumpLevels[levelMatch[0] as "major" | "minor" | "patch"];
      highestLevel = Math.max(level, highestLevel);
    }

    // Search for heading of the entry
    if (headingText === version) {
      headingStartInfo = { index: regex.lastIndex, depth: headingDepth };
      continue;
    }

    // If we've found the entry heading, search for the closing heading with the same depth
    if (headingStartInfo && headingDepth === headingStartInfo.depth) {
      endIndex = match.index;
      break;
    }
  }

  if (!headingStartInfo) {
    return;
  }

  return {
    content: changelog.slice(headingStartInfo?.index, endIndex).trim(),
    highestLevel,
  };
}
