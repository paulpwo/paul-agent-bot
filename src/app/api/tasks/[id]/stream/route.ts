import { NextRequest } from "next/server"
import { db } from "@/lib/db/client"
import { STREAM_CHANNEL } from "@/lib/redis/pubsub"
import { redisSub } from "@/lib/redis/client"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const task = await db.task.findUnique({ where: { id } })
  if (!task) return new Response("Not found", { status: 404 })

  const channel = STREAM_CHANNEL(id)

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`)
      }

      // If task already finished, send final event immediately and close
      if (task.status === "COMPLETED") {
        send({ type: "done", taskId: id, result: task.result ?? "" })
        controller.close()
        return
      }
      if (task.status === "FAILED" || task.status === "CANCELLED") {
        send({ type: "error", taskId: id, message: task.errorMessage ?? task.status })
        controller.close()
        return
      }

      const onMessage = (ch: string, message: string) => {
        if (ch !== channel) return
        try {
          const event = JSON.parse(message)
          send(event)
          if (event.type === "done" || event.type === "error") {
            redisSub.unsubscribe(channel)
            redisSub.removeListener("message", onMessage)
            controller.close()
          }
        } catch { /* ignore */ }
      }

      redisSub.on("message", onMessage)
      await redisSub.subscribe(channel)
    },
    cancel() {
      redisSub.unsubscribe(channel)
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}
