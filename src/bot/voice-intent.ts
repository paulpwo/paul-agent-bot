/**
 * Detect whether the user is asking for a voice note reply.
 * Matches Spanish and English variants.
 */
const VOICE_REPLY_PATTERN =
  /\b(nota[s]?\s*de\s*voz|voice\s*note[s]?|responde[r]?\s*(con|en)\s*(voz|audio)|respond\s*(with|in)\s*(a\s*)?(voice|audio)|con\s*(voz|audio)|en\s*(voz|audio)|voice\s*reply|audio\s*reply|manda[me]?\s*(una?)?\s*(nota\s*de\s*)?(voz|audio)|send\s*(a\s*)?(voice|audio))\b/i

export function wantsVoiceReply(prompt: string): boolean {
  return VOICE_REPLY_PATTERN.test(prompt)
}
