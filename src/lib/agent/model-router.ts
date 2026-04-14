export type TaskComplexity = "complex" | "coding" | "simple"

interface ModelConfig {
  model: string
  provider: "local" | "openrouter"
}

const MODEL_MAP: Record<TaskComplexity, ModelConfig> = {
  complex: { model: "claude-opus-4-6", provider: "local" },
  coding:  { model: "claude-sonnet-4-6", provider: "local" },
  simple:  { model: "claude-haiku-4-5-20251001", provider: "local" },
}

// Classify task complexity from prompt heuristics
export function classifyTask(prompt: string): TaskComplexity {
  const lower = prompt.toLowerCase()

  // Complex: architecture, design, refactor, explain
  if (/architect|refactor|design|explain|review|analyz/.test(lower)) return "complex"

  // Simple: status, list, summarize
  if (/status|list|show|what is|how many|summary/.test(lower)) return "simple"

  // Default: coding tasks
  return "coding"
}

export function resolveModel(hint?: TaskComplexity): string {
  const complexity = hint ?? "coding"
  return MODEL_MAP[complexity].model
}
