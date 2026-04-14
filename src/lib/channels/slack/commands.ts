/**
 * Parse PaulBot commands from Slack message text.
 *
 * Supported forms (when bot is mentioned):
 *   @paulbot repo owner/name
 *   @paulbot status
 *   @paulbot new
 *   @paulbot stop
 *
 * Also parses slash-command style (if Slack slash commands route here):
 *   /paulbot repo owner/name
 *   /paulbot status
 */

export type PaulBotCommand =
  | { type: "repo"; repo: string }
  | { type: "status" }
  | { type: "new" }
  | { type: "stop" }
  | { type: "unknown"; raw: string }

/**
 * Parse the text of a Slack message (after bot mention stripping) into a command.
 * Returns null if no command was found (treat as a regular prompt).
 */
export function parseCommand(text: string): PaulBotCommand | null {
  // Strip bot mentions: <@U12345> or <@U12345|username>
  const clean = text.replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/g, "").trim()

  // Match slash-command prefix or bare command
  const slashMatch = clean.match(/^\/paulbot\s+(\w+)(?:\s+(.+))?$/i)
  const bareMatch = clean.match(/^(\w+)(?:\s+(.+))?$/)

  const verb = (slashMatch?.[1] ?? bareMatch?.[1] ?? "").toLowerCase()
  const arg = slashMatch?.[2] ?? bareMatch?.[2]

  switch (verb) {
    case "repo": {
      if (!arg || !arg.includes("/")) {
        return { type: "unknown", raw: clean }
      }
      return { type: "repo", repo: arg.trim() }
    }
    case "status":
      return { type: "status" }
    case "new":
      return { type: "new" }
    case "stop":
      return { type: "stop" }
    default:
      return null // not a command — treat as a prompt
  }
}

/**
 * Returns true if the text appears to be a PaulBot command (not a free-form prompt).
 */
export function isCommand(text: string): boolean {
  return parseCommand(text) !== null
}
