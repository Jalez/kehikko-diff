import { doorsFetch, type DoorsOptions } from 'kehikot-module-protocol/serve'

/**
 * One request through the protocol's doors (`doorsFetch`: the same doors `vite.config.ts` mounts,
 * from a `Request` to a `Response`) — so a test can say which HEADER a write carried, which calling
 * `answer` directly cannot: there the ticket is already an argument and the header's name is never
 * read.
 */
export interface Sent {
  status: number
  headers: Record<string, string>
  text: string
  /** True when the doors handed the request on to Vite rather than answering it. */
  passed: boolean
  json: () => Record<string, unknown>
}

export async function through(
  options: DoorsOptions,
  method: string,
  url: string,
  { body, headers = {} }: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<Sent> {
  const sent = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  const response = await doorsFetch(options)(new Request(`http://127.0.0.1${url}`, { method, headers, body: sent }))
  const text = response ? await response.text() : ''
  return {
    status: response?.status ?? 0,
    headers: response ? Object.fromEntries(response.headers) : {},
    text,
    passed: response === null,
    json: () => JSON.parse(text) as Record<string, unknown>,
  }
}
