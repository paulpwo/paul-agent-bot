"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

interface Props {
  taskId: string
}

export default function DeleteTaskButton({ taskId }: Props) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!window.confirm("¿Eliminar esta tarea?")) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/dashboard/tasks")
      }
    } catch { /* ignore */ } finally {
      setDeleting(false)
    }
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="text-xs text-text-muted hover:text-red-400 disabled:opacity-40 transition-colors px-2 py-1 rounded border border-border-default hover:border-red-400/40 hover:bg-red-400/10"
    >
      {deleting ? "Eliminando..." : "Eliminar tarea"}
    </button>
  )
}
