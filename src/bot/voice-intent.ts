/**
 * Detect whether the user is asking for a voice note reply.
 * Matches Spanish and English variants.
 */
const VOICE_REPLY_PATTERN =
  /\b(nota[s]?\s*de\s*voz|voice\s*note[s]?|responde[r]?\s*(con|en)\s*voz|respond\s*(with|in)\s*(a\s*)?voice|con\s*voz|en\s*voz|voice\s*reply|manda[me]?\s*(una)?\s*(nota\s*de\s*)?voz|send\s*(a\s*)?voice)\b/i

export function wantsVoiceReply(prompt: string): boolean {
  return VOICE_REPLY_PATTERN.test(prompt)
}
