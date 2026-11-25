import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, test } from 'vitest'
import { DELETE as deleteRoute, PATCH as hideRoute } from '@/app/api/e/[code]/comments/[commentId]/route'
import { GET as listRoute, POST as addRoute } from '@/app/api/e/[code]/photos/[photoId]/comments/route'
import { PUT as heartRoute } from '@/app/api/e/[code]/photos/[photoId]/heart/route'
import { db } from '@/db/client'
import { comments, events, hearts, participants, photos, type EventRow, type PhotoRow } from '@/db/schema'
import { addComment, deleteComment, hideComment, listComments } from '@/modules/social/comments'
import { setHeart } from '@/modules/social/hearts'
import { resetDb } from '../helpers/db'
import { makeEvent, makeGuest, makePhoto } from '../helpers/factory'
import { asGuest, fresh, type Unlocked } from '../helpers/upload'

let e: EventRow
let p: PhotoRow
let ana: Unlocked
let ben: Unlocked
let host: Unlocked
beforeEach(async () => {
  await resetDb()
  e = await makeEvent()
  ana = asGuest(e.id, (await makeGuest(e.id, { name: 'Ana' })).id)
  ben = asGuest(e.id, (await makeGuest(e.id)).id)
  host = { kind: 'host', eventId: e.id, participantId: (await makeGuest(e.id, { name: 'Host' })).id, userId: 'u' }
  p = await makePhoto(e.id, ana.participantId)
})

const code = (x: Promise<unknown>) => x.then(() => 'ok', (err: { code: string }) => err.code)
const heartCount = async () => (await db.select().from(photos).where(eq(photos.id, p.id)))[0]!.heartCount
const change = async (set: Partial<typeof events.$inferInsert>) => {
  await db.update(events).set(set).where(eq(events.id, e.id))
  e = await fresh(e)
}
const texts = async (v: Unlocked) => (await listComments(v, e, p.id)).items.map((c) => c.text)

describe('hearts', () => {
  test('one per person, however fast they tap', async () => {
    await Promise.all(Array.from({ length: 20 }, () => setHeart(ben, e, p.id, true)))
    expect(await heartCount()).toBe(1)
  })
  test('twenty people at once', async () => {
    const all = await Promise.all(Array.from({ length: 20 }, async () => asGuest(e.id, (await makeGuest(e.id)).id)))
    await Promise.all(all.map((v) => setHeart(v, e, p.id, true)))
    expect(await heartCount()).toBe(20)
  })
  test('taking it back twice never goes below zero', async () => {
    expect(await setHeart(ben, e, p.id, true)).toEqual({ heartCount: 1, hearted: true })
    expect(await setHeart(ben, e, p.id, false)).toEqual({ heartCount: 0, hearted: false })
    expect(await setHeart(ben, e, p.id, false)).toEqual({ heartCount: 0, hearted: false })
    expect(await db.select().from(hearts)).toHaveLength(0)
  })
  test('tapping on and off quickly ends consistent', async () => {
    await Promise.all(Array.from({ length: 30 }, (_, i) => setHeart(ben, e, p.id, i % 2 === 0)))
    expect(await heartCount()).toBe((await db.select().from(hearts)).length)
  })
})

describe('comments', () => {
  test('are listed oldest first, with names', async () => {
    await addComment(ana, e, p.id, { text: 'First!' })
    await addComment(ben, e, p.id, { text: '  Second\r\n\r\n\r\n\r\nline  ', name: 'Ben' })
    const { items } = await listComments(ana, e, p.id)
    expect(items).toMatchObject([
      { author: 'Ana', text: 'First!', mine: true, canDelete: true },
      { author: 'Ben', text: 'Second\n\nline', mine: false, canDelete: false },
    ])
    expect((await db.select().from(participants).where(eq(participants.id, ben.participantId)))[0]!.name).toBe('Ben')
  })
  test('500 characters, no more and no blanks', async () => {
    expect(await code(addComment(ben, e, p.id, { text: 'x'.repeat(500) }))).toBe('ok')
    expect(await code(addComment(ben, e, p.id, { text: '🎉'.repeat(500) }))).toBe('ok')
    expect(await code(addComment(ben, e, p.id, { text: 'x'.repeat(501) }))).not.toBe('ok')
    expect(await code(addComment(ben, e, p.id, { text: ' \n​ ' }))).not.toBe('ok')
  })
  test('the eleventh in a minute waits', async () => {
    const results = await Promise.all(Array.from({ length: 24 }, (_, i) => code(addComment(ben, e, p.id, { text: `c${i}` }))))
    expect(results.filter((r) => r === 'ok').length).toBeLessThanOrEqual(20) // a minute may turn over
    expect(results).toContain('rate_limited')
    expect(await code(addComment(ana, e, p.id, { text: 'mine is fine' }))).toBe('ok')
  })
  test('pages come once each', async () => {
    const at = new Date()
    await db.insert(comments).values(
      Array.from({ length: 70 }, (_, i) => ({ eventId: e.id, photoId: p.id, participantId: ben.participantId, text: `c${i}`, createdAt: at })),
    )
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const page: Awaited<ReturnType<typeof listComments>> = await listComments(ana, e, p.id, cursor)
      seen.push(...page.items.map((c) => c.id))
      cursor = page.next
    } while (cursor)
    expect(new Set(seen).size).toBe(70)
    expect(seen).toHaveLength(70)
    expect(await code(listComments(ana, e, p.id, 'garbage'))).toBe('bad_input')
  })
})

describe('who may', () => {
  const tries = (v: Unlocked) => Promise.all([code(setHeart(v, e, p.id, true)), code(addComment(v, e, p.id, { text: 'hi' }))])

  test.each(['hidden', 'pending', 'deleted', 'failed'] as const)('a %s photo is not found by guests', async (status) => {
    await db.update(photos).set({ status }).where(eq(photos.id, p.id))
    expect(await tries(ben)).toEqual(['not_found', 'not_found'])
    expect(await code(listComments(ben, e, p.id))).toBe('not_found')
  })
  test('a photo of another event is not found', async () => {
    const e2 = await makeEvent()
    const theirs = await makePhoto(e2.id, (await makeGuest(e2.id)).id)
    expect(await code(setHeart(host, e, theirs.id, true))).toBe('not_found')
    expect(await code(addComment(host, e, theirs.id, { text: 'x' }))).toBe('not_found')
  })
  test('each can be off by itself, and comes back unchanged', async () => {
    await setHeart(ben, e, p.id, true)
    await addComment(ben, e, p.id, { text: 'kept' })
    await change({ settings: { ...e.settings, hearts: false } })
    expect(await tries(ana)).toEqual(['feature_off', 'ok'])
    await change({ settings: { ...e.settings, hearts: true, comments: false } })
    expect(await tries(ana)).toEqual(['ok', 'feature_off'])
    expect(await code(listComments(ana, e, p.id))).toBe('feature_off')
    await change({ settings: { ...e.settings, comments: true } })
    expect(await texts(ana)).toEqual(['kept', 'hi'])
  })
  test('when closed, guests cannot and the host can', async () => {
    await change({ frozenAt: new Date() })
    expect(await tries(ben)).toEqual(['frozen', 'frozen'])
    expect(await tries(host)).toEqual(['ok', 'ok'])
    expect(await texts(ben)).toEqual(['hi'])
  })
})

describe('removing comments', () => {
  test('guests remove only their own, also when closed', async () => {
    const mine = await addComment(ben, e, p.id, { text: 'mine' })
    expect(await code(deleteComment(ana, e, mine.id))).toBe('forbidden')
    await change({ frozenAt: new Date() })
    expect(await code(deleteComment(ben, e, mine.id))).toBe('ok')
    expect(await texts(host)).toEqual([])
    expect(await code(deleteComment(ben, e, mine.id))).toBe('not_found')
  })
  test('the host removes or hides any', async () => {
    const a = await addComment(ben, e, p.id, { text: 'a' })
    const b = await addComment(ana, e, p.id, { text: 'b' })
    await deleteComment(host, e, a.id)
    await hideComment(host, e, b.id, true)
    expect(await texts(ana)).toEqual([])
    expect((await listComments(host, e, p.id)).items).toMatchObject([{ text: 'b', hidden: true }])
    await hideComment(host, e, b.id, false)
    expect(await texts(ben)).toEqual(['b'])
    expect(await code(hideComment(ben, e, b.id, true))).toBe('forbidden')
  })
  test("another event's comment is not found", async () => {
    const e2 = await makeEvent()
    const p2 = await makePhoto(e2.id, (await makeGuest(e2.id)).id)
    const [c] = await db.insert(comments).values({ eventId: e2.id, photoId: p2.id, participantId: p2.participantId, text: 'x' }).returning()
    expect(await code(deleteComment(host, e, c!.id))).toBe('not_found')
    expect(await code(hideComment(host, e, c!.id, true))).toBe('not_found')
  })
  test('a guest cannot use a comment to reach a photo they cannot see', async () => {
    const c = await addComment(ben, e, p.id, { text: 'x' })
    await db.update(photos).set({ status: 'hidden' }).where(eq(photos.id, p.id))
    expect(await code(deleteComment(ben, e, c.id))).toBe('ok') // still theirs to take back
  })
})

test('the routes', async () => {
  const g = await makeGuest(e.id)
  const req = (method: string, body?: unknown) =>
    new Request('http://localhost:3000/x', { method, headers: { cookie: `qg=${g.token}` }, body: body ? JSON.stringify(body) : undefined })
  const ctx = { params: Promise.resolve({ code: e.code, photoId: p.id }) }
  expect(await (await heartRoute(req('PUT', { on: true }), ctx)).json()).toEqual({ heartCount: 1, hearted: true })
  expect((await heartRoute(req('PUT', { on: 'yes' }), ctx)).status).toBe(400)
  const made = (await (await addRoute(req('POST', { text: '<script>alert(1)</script>' }), ctx)).json()) as { id: string; text: string }
  expect(made.text).toBe('<script>alert(1)</script>')
  expect((await (await listRoute(req('GET'), ctx)).json()).items).toHaveLength(1)
  const cc = { params: Promise.resolve({ code: e.code, commentId: made.id }) }
  expect((await hideRoute(req('PATCH', { hidden: true }), cc)).status).toBe(403)
  expect((await deleteRoute(req('DELETE'), cc)).status).toBe(200)
  expect((await deleteRoute(req('DELETE'), { params: Promise.resolve({ code: e.code, commentId: 'nope' }) })).status).toBe(404)
})
