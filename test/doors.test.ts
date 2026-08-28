import { describe, expect, test } from 'bun:test'

import { answer } from '../doors.ts'
import { ID, MANIFEST } from '../manifest.ts'

const q = (search: string) => new URLSearchParams(search)

describe('answer', () => {
  test('anything that is not one of ours is passed on', async () => {
    /* `null` is what makes the page, its modules and Vite's hot-reload socket
       keep working through the same middleware stack. */
    expect(await answer('GET', '/', q(''))).toBeNull()
    expect(await answer('GET', '/src/main.tsx', q(''))).toBeNull()
  })

  test('the health check says who is answering', async () => {
    const reply = await answer('GET', '/healthz', q(''))
    expect(reply?.status).toBe(200)
    expect(reply?.body).toMatchObject({ ok: true, id: ID })
    /* A count and never a listing: what is in the cache is somebody's source
       code, and a health check is the last place that should be readable. */
    expect(typeof (reply?.body as { cached: unknown }).cached).toBe('number')
  })

  test('a diff asked for without an address is a bad request', async () => {
    const reply = await answer('GET', '/api/diff', q(''))
    expect(reply?.status).toBe(400)
  })

  test('an address this app cannot read is answered in words, not with a 500', async () => {
    /* It is a fact about the reference rather than a failure of the program, so
       it comes back as an ordinary reply the page can put on screen. */
    const reply = await answer('GET', '/api/diff', q('url=https://example.com/x&sha=abc'))
    expect(reply?.status).toBe(200)
    expect(reply?.body).toMatchObject({ ok: false })
  })

  test('a change with no head commit is refused before anything is run', async () => {
    /* Not fetched-and-filed-under-nothing: that key would be shared by every
       unshaed change, which is one change's diff answering under another's name. */
    const reply = await answer('GET', '/api/diff', q('url=https://github.com/o/r/pull/1'))
    expect(reply?.body).toMatchObject({ ok: false })
    expect(String((reply?.body as { error: string }).error)).toContain('head commit')
  })

  test('the doors only answer GET', async () => {
    expect((await answer('POST', '/healthz', q('')))?.status).toBe(405)
    expect((await answer('DELETE', '/api/diff', q('')))?.status).toBe(405)
  })
})

describe('manifest', () => {
  test('it parses against the protocol’s own schema, at import', () => {
    /* The parse happens in `manifest.ts` itself; this asserts the result is the
       one this module means to publish. A summary one character over the
       protocol's limit should stop this process rather than a host's. */
    expect(MANIFEST.id).toBe('roadmap.diff')
    expect(MANIFEST.entry).toBe('/')
  })

  test('it asks for the one capability it cannot work without, and no others', () => {
    expect(MANIFEST.declares.uses).toEqual(['live:read'])
  })

  test('storage is declared, which is what keeps the credentialed door same-origin', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('no prompt is offered, because nothing a person could write would change a line of a patch', () => {
    expect(MANIFEST.declares.prompt).toBe(false)
  })
})
