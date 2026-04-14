"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { Session } from "@prisma/client"
import type { Task } from "@prisma/client"
import type { StreamEvent } from "@/lib/redis/pubsub"
import { MessageBubble, type Message } from "./MessageBubble"

type ToolCallEvent = Extract<StreamEvent, { type: "tool_use" }>
type ApprovalEvent = Extract<StreamEvent, { type: "approval_needed" }>

interface RecentSession extends Session {
  tasks: Task[]
}

interface ChatPageProps {
  initialSession?: Session
  initialMessages?: Message[]
  recentSessions: RecentSession[]
  repos: { fullName: string }[]
}

function taskToMessage(task: Task): Message[] {
  const user: Message = {
    id: `${task.id}-user`,
    role: "user",
    content: task.prompt,
    status: "done",
    toolCalls: [],
  }
  const agent: Message = {
    id: task.id,
    role: "agent",
    content: task.result ?? task.errorMessage ?? "",
    status:
      task.status === "COMPLETED"
        ? "done"
        : task.status === "FAILED"
          ? "error"
          : task.status === "CANCELLED"
            ? "cancelled"
            : "done",
    toolCalls: [],
  }
  return [user, agent]
}

export function ChatPage({ initialSession, initialMessages, recentSessions, repos }: ChatPageProps) {
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | undefined>(initialSession?.id)
  const [selectedRepo, setSelectedRepo] = useState<string>(
    initialSession?.repo ?? repos[0]?.fullName ?? ""
  )
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? [])
  const [input, setInput] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [sessions, setSessions] = useState(recentSessions)

  // Branch state
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string>("main")

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const activeEvtSource = useRef<EventSource | null>(null)

  const hasStartedChat = messages.length > 0

  // Fetch branches when repo changes
  useEffect(() => {
    if (!selectedRepo) return
    fetch(`/api/repos/branches?repo=${encodeURIComponent(selectedRepo)}`)
      .then((r) => r.json())
      .then((data: { branches: string[]; current: string | null }) => {
        setBranches(data.branches ?? [])
        // If session has a threadId, prefer paulagentbot/<threadId> branch
        const sessionBranch = initialSession?.threadId
          ? `paulagentbot/${initialSession.threadId}`
          : null
        const resolved =
          sessionBranch && (data.branches ?? []).includes(sessionBranch)
            ? sessionBranch
            : data.current ?? "main"
        setCurrentBranch(resolved)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Auto-reconnect stream when loading a session that has a running task
  useEffect(() => {
    const runningMsg = (initialMessages ?? []).find(
      (m) => m.role === "agent" && m.status === "streaming"
    )
    if (runningMsg) {
      setIsStreaming(true)
      streamTask(runningMsg.id)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" })
    setSessions((prev) => prev.filter((s) => s.id !== id))
    if (sessionId === id) {
      setSessionId(undefined)
      setMessages([])
      router.push("/dashboard/chat")
    }
  }

  const streamTask = useCallback((taskId: string) => {
    if (activeEvtSource.current) {
      activeEvtSource.current.close()
    }

    const evtSource = new EventSource(`/api/tasks/${taskId}/stream`)
    activeEvtSource.current = evtSource

    evtSource.onmessage = (e: MessageEvent) => {
      const event = JSON.parse(e.data as string) as StreamEvent & { type: string }

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === taskId)
        if (idx === -1) return prev

        const updated = [...prev]
        const msg = { ...updated[idx] }

        if (event.type === "token") {
          msg.content += (event as Extract<StreamEvent, { type: "token" }>).text
          msg.status = "streaming"
        } else if (event.type === "tool_use") {
          msg.toolCalls = [...msg.toolCalls, event as ToolCallEvent]
        } else if (event.type === "approval_needed") {
          msg.approvalRequest = event as ApprovalEvent
        } else if (event.type === "done") {
          if (!msg.content && (event as { result?: string }).result) {
            msg.content = (event as { result?: string }).result!
          }
          msg.status = "done"
          msg.approvalRequest = undefined
          evtSource.close()
          setIsStreaming(false)
        } else if (event.type === "error") {
          msg.content = (event as { message?: string }).message ?? ""
          msg.status = "error"
          evtSource.close()
          setIsStreaming(false)
        }

        updated[idx] = msg
        return updated
      })
    }

    evtSource.onerror = () => {
      evtSource.close()
      setIsStreaming(false)
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === taskId)
        if (idx === -1) return prev
        const updated = [...prev]
        const msg = { ...updated[idx] }
        if (msg.status === "streaming" || msg.status === "pending") {
          msg.status = "error"
        }
        updated[idx] = msg
        return updated
      })
    }
  }, [])

  const sendMessage = useCallback(async () => {
    const prompt = input.trim()
    if (!prompt || isStreaming || !selectedRepo) return

    setInput("")
    setIsStreaming(true)

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: prompt,
      status: "done",
      toolCalls: [],
    }
    const agentMsg: Message = {
      id: `pending-${Date.now()}`,
      role: "agent",
      content: "",
      status: "streaming",
      toolCalls: [],
    }

    setMessages((prev) => [...prev, userMsg, agentMsg])

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, repo: selectedRepo, prompt }),
      })

      if (!res.ok) throw new Error("Failed to send message")

      const data = (await res.json()) as { taskId: string; sessionId: string }

      if (!sessionId) {
        setSessionId(data.sessionId)
        // Use history.replaceState instead of router.replace to avoid
        // unmounting this component (and killing the active EventSource stream)
        window.history.replaceState(null, "", `/dashboard/chat/${data.sessionId}`)
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === agentMsg.id ? { ...m, id: data.taskId } : m))
      )

      streamTask(data.taskId)
    } catch {
      setIsStreaming(false)
      setMessages((prev) =>
        prev.map((m) => (m.id === agentMsg.id ? { ...m, status: "error" } : m))
      )
    }
  }, [input, isStreaming, selectedRepo, sessionId, streamTask, router])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void sendMessage()
    }
  }

  const handleApprove = async (taskId: string, approvalId: string, approved: boolean) => {
    await fetch(`/api/tasks/${taskId}/approval`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId, approved }),
    })
    setMessages((prev) =>
      prev.map((m) => (m.id === taskId ? { ...m, approvalRequest: undefined } : m))
    )
  }

  const startNewChat = () => {
    if (activeEvtSource.current) activeEvtSource.current.close()
    setSessionId(undefined)
    setMessages([])
    setInput("")
    setIsStreaming(false)
    router.push("/dashboard/chat")
  }

  const handlePull = () => {
    if (isStreaming) return
    setInput("Please pull the latest changes from the remote repository.")
    inputRef.current?.focus()
  }

  const handlePush = () => {
    if (isStreaming) return
    setInput("Please push the current branch to the remote repository.")
    inputRef.current?.focus()
  }

  return (
    <div className="flex h-full overflow-hidden bg-surface-base">
      {/* Sessions sidebar */}
      <aside className="w-52 glass-overlay flex flex-col shrink-0">
        <div className="p-3 border-b border-border-default/60">
          <p className="text-[11px] text-text-muted uppercase tracking-wider font-medium px-1 mb-2">
            Chats
          </p>
          <button
            onClick={startNewChat}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-white hover:bg-surface-overlay transition-colors text-left"
          >
            <span className="text-sm font-light">+</span>
            <span>New chat</span>
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sessions.length === 0 && (
            <p className="text-xs text-text-muted px-3 py-2">No chats yet</p>
          )}
          {sessions.map((s) => {
            const isActive = s.id === sessionId
            const lastTask = s.tasks[0]
            return (
              <div
                key={s.id}
                className={`group flex items-center gap-1 rounded-lg text-xs transition-colors cursor-pointer ${
                  isActive ? "bg-surface-overlay text-white" : "text-text-secondary hover:text-white hover:bg-surface-overlay/70"
                }`}
              >
                <button
                  onClick={() => router.push(`/dashboard/chat/${s.id}`)}
                  className="flex-1 text-left px-3 py-2 min-w-0"
                >
                  <p className="truncate font-medium text-[11px] text-text-secondary">{s.repo}</p>
                  {lastTask && (
                    <p className="truncate text-text-muted mt-0.5 text-[12px]">{lastTask.prompt}</p>
                  )}
                </button>
                <button
                  onClick={(e) => void deleteSession(s.id, e)}
                  className="shrink-0 pr-2 opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all text-base leading-none"
                  title="Delete chat"
                >
                  ×
                </button>
              </div>
            )
          })}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-5 py-3 border-b border-glass-border glass-overlay shrink-0">
          <a href="/dashboard" className="text-text-muted hover:text-text-primary text-sm transition-colors">
            ←
          </a>
          <span className="text-sm font-medium text-text-primary">Chat</span>
          <div className="flex-1" />
          <button
            onClick={startNewChat}
            className="text-xs bg-surface-overlay/80 hover:bg-surface-overlay text-text-secondary hover:text-white px-3 py-1.5 rounded-lg transition-colors border border-border-subtle/50"
          >
            + New chat
          </button>
        </header>

        {/* Message thread */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-surface-raised border border-border-default flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400">
                  <path d="M12 2a3 3 0 0 1 3 3v1a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
                  <path d="M19 9H5a2 2 0 0 0-2 2v1a10 10 0 0 0 18 0v-1a2 2 0 0 0-2-2z"/>
                  <path d="M12 16v6M8 22h8"/>
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">PaulAgentBot</p>
                <p className="text-xs text-text-muted mt-1 max-w-[220px]">
                  Select a repo and branch below, then describe what you need.
                </p>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onApprove={handleApprove} />
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="shrink-0 border-t border-glass-border glass-overlay px-4 pt-3 pb-4">
          {/* Textarea row */}
          <div className="flex items-end gap-2 mb-2.5">
            {/* Clip icon — future */}
            <button
              disabled
              title="Attach image (coming soon)"
              className="shrink-0 mb-1.5 p-1.5 rounded-lg text-text-muted cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
              </svg>
            </button>

            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming || !selectedRepo}
              placeholder={
                isStreaming
                  ? "Agent is working…"
                  : selectedRepo
                    ? "Type a message… (Enter to send, Shift+Enter for newline)"
                    : "Select a repo below first"
              }
              rows={1}
              className="flex-1 bg-surface-raised border border-border-default hover:border-border-subtle focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-text-primary placeholder-text-muted focus:outline-none disabled:opacity-40 resize-none min-h-[42px] max-h-[160px] overflow-y-auto leading-relaxed transition-colors"
              style={{ height: "auto" }}
              onInput={(e) => {
                const el = e.currentTarget
                el.style.height = "auto"
                el.style.height = Math.min(el.scrollHeight, 160) + "px"
              }}
            />

            {/* Audio icon — future */}
            <button
              disabled
              title="Record audio (coming soon)"
              className="shrink-0 mb-1.5 p-1.5 rounded-lg text-text-muted cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="22"/>
              </svg>
            </button>

            <button
              onClick={() => void sendMessage()}
              disabled={isStreaming || !input.trim() || !selectedRepo}
              className="shrink-0 mb-1.5 h-[42px] px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              Send ↵
            </button>
          </div>

          {/* Toolbar: repo, branch, pull, push */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Repo selector */}
            <select
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              disabled={isStreaming || hasStartedChat}
              title={hasStartedChat ? "Repo is locked for this chat" : "Select repo"}
              className="text-xs bg-surface-raised border border-border-default rounded-lg px-2.5 py-1.5 text-text-secondary focus:outline-none focus:border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed max-w-[180px] transition-colors"
            >
              {repos.length === 0 && <option value="">No repos configured</option>}
              {repos.map((r) => (
                <option key={r.fullName} value={r.fullName}>
                  {r.fullName}
                </option>
              ))}
            </select>

            {/* Branch selector */}
            <div className={`flex items-center gap-1.5 bg-surface-raised border rounded-lg px-2.5 py-1.5 ${hasStartedChat ? "border-border-default/50 opacity-60" : "border-border-default"}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0">
                <line x1="6" y1="3" x2="6" y2="15"/>
                <circle cx="18" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              <select
                value={currentBranch}
                onChange={(e) => setCurrentBranch(e.target.value)}
                disabled={isStreaming || hasStartedChat}
                title={hasStartedChat ? "Branch is locked for this session" : "Select branch"}
                className="text-xs bg-transparent text-text-secondary focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed max-w-[140px]"
              >
                {branches.length === 0
                  ? <option value={currentBranch}>{currentBranch}</option>
                  : branches.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))
                }
              </select>
            </div>

            {/* Pull */}
            <button
              onClick={() => void handlePull()}
              disabled={isStreaming || !selectedRepo}
              title="Pull latest"
              className="flex items-center gap-1.5 text-xs bg-surface-raised border border-border-default hover:border-border-subtle hover:text-text-primary text-text-muted rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Pull
            </button>

            {/* Push */}
            <button
              onClick={() => void handlePush()}
              disabled={isStreaming || !selectedRepo}
              title="Push branch"
              className="flex items-center gap-1.5 text-xs bg-surface-raised border border-border-default hover:border-border-subtle hover:text-text-primary text-text-muted rounded-lg px-2.5 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              Push
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
