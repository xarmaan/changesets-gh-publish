// GitHub Issues/PRs messages have a max size limit on the
// message body payload.
// `body is too long (maximum is 65536 characters)`.
// To avoid that, we ensure to cap the message to 60k chars.
export const MAX_CHARACTERS_PER_MESSAGE = 60000;

export const GITHUB_ACTIONS_BOT_USER_NAME = "github-actions[bot]";
export const GITHUB_ACTIONS_BOT_USER_EMAIL =
  "41898282+github-actions[bot]@users.noreply.github.com";
