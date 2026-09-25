import type { Run, StreamEvent } from './content'

type AgentEvent =
  | [name: 'run', data: { runId: string; itemId: string; run?: Run }]
  | [name: 'tool', data: Extract<StreamEvent, { type: 'tool' }>]
  | [name: 'text', data: { delta: string }]
  | [name: 'finish', data: { runId: string; itemId: string; lastSeq: number }]
  | [name: 'error', data: { message: string }]

export async function readAgentEvents(stream: ReadableStream<Uint8Array>, onEvent: (...event: AgentEvent) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        const lines = block.split(/\r?\n/)
        const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (name && data) onEvent(...[name, JSON.parse(data)] as AgentEvent)
      }
      if (done) return
    }
  } finally { reader.releaseLock() }
}
