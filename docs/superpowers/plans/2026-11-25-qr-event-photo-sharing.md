# Live QR Event Photo Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public web app where any host creates an event, guests scan a QR code to add original-quality photos without an account, and everyone watches the gallery fill live.

**Architecture:** One repository, two Node processes: `web` (Next.js pages, JSON API, server-sent events) and `worker` (pg-boss jobs for imaging, exports and cleanup). Postgres holds all state, jobs and change notifications. Browsers send photo bytes straight to object storage through signed URLs; storage is R2 in production and local disk in development, behind one interface.

**Tech Stack:** Next.js 16.4, React 19.3, TypeScript strict, Drizzle ORM 0.45, pg 8.23, Postgres 18, TanStack Query 5 / Virtual 3 / Form 1, Better Auth 1.7, pg-boss 12, sharp 0.35, libheif-js 1.23, Tailwind 4, Zod 4, Vitest 5, Playwright 1.65

**Spec:** `docs/superpowers/specs/2026-11-25-qr-event-photo-sharing-design.md`

## Global Constraints

- Photos accepted: JPEG, PNG, WebP, HEIC/HEIF, AVIF; at most 40 MB and 100 megapixels. Decide type from bytes.
- Limits: 5,000 photos and 25 GB per event; 10 events per host; per guest 500 photos per event, 60 reservations/minute, 10 comments/minute.
- PIN: 4 digits. Wrong attempts: 5 per guest per 15 min, 100 per IP per hour, 500 per event per hour then a 10-minute pause. Only wrong attempts count.
- Names 40 characters; comments 500; hashtags 10 per photo, 40 characters each, Unicode letters/digits/underscore, case-insensitive.
- Event code: 12 base58 characters. Guest token: 256 random bits; store SHA-256 only.
- Versions made: 480 px and 2048 px long edge, WebP, no metadata, sRGB. Originals byte-identical.
- Image URLs: identical for one hour, invalid within two hours. Upload URLs: 15 minutes.
- Freeze grace for files already reserved: 10 minutes. Reservations expire after 24 hours. Export links 7 days. Event undo 7 days.
- Permissions are decided only in `src/modules/access`. Every query for an event's object filters by event ID.
- Never log PINs, tokens or signed URLs. Never render guest text as HTML.
- The only publicly visible name is `APP_NAME` from config, default `Event Photos`.
- WCAG AA contrast; reduced motion respected; light theme except TV and the full-screen photo.
- Errors to clients: `{ error: { code, message } }`, with a plain sentence and no stack.

## Verified facts the tasks rely on

Checked on 2026-11-25 with these versions on Node 26:

- sharp reads HEIC metadata, EXIF and ICC but **cannot decode HEIC**. libheif-js decodes it (about 0.8 s for 12 MP) with orientation already applied and **without color conversion**, so Display P3 iPhone photos come out dull unless the ICC profile is reattached. Task 7 has the working method.
- sharp drops EXIF and converts to sRGB by default on output.
- exifr must be called with `reviveValues: false`, or it turns camera time into the server's time zone.
- pg-boss 12 fails to import unless `@opentelemetry/api` is installed. `boss.send(name, data, { db: fromDrizzle(tx, sql) })` enqueues inside a Drizzle transaction.
- archiver 8 exports `ZipArchive` (no default function).
- Next.js 16 uses `proxy.ts`, not `middleware.ts`. CSP nonces need dynamically rendered pages. Its bundled docs are in `node_modules/next/dist/docs`; read them before using an unfamiliar API.
- The Better Auth CLI package is `auth` (1.7.28); the older `@better-auth/cli` lags behind.
- macOS `sips` makes HEIC test fixtures.
- **Not verified:** R2 honoring a signed `Content-Length`, and real-phone behavior. Both need the user.

## Review Focus

1. **Album deleted or tag blocked while a guest's photo is queued:** accept the photo without that album or tag; never fail it. (Task 8)
2. **PIN or event link changed while photos are queued:** pause, ask for the PIN or the new link, and keep every file; resume after. (Task 11)
3. **TV or gallery left open past image-URL expiry:** fetch fresh URLs; never show broken images. (Tasks 10, 17)
4. **Names with emoji, right-to-left text, `<script>`, slashes or a missing font glyph:** safe in pages, ZIP names and signs, and the host is warned about characters a sign can't print. (Tasks 13, 16, 18)
5. **Nothing there:** an empty gallery, TV with no photos, or an export of zero photos shows a helpful state; an export of nothing is refused. (Tasks 10, 17, 18)

## File Structure

```
src/
  config.ts                 env parsing, limits, APP_NAME
  proxy.ts                  guest cookie, CSP nonce, same-origin check
  db/        client.ts  schema.ts  auth-schema.ts
  lib/       errors.ts  ids.ts  route.ts (handler wrapper)  rate-limit.ts  mail.ts  ip.ts
  modules/
    access/   viewer.ts  can.ts
    events/   events.ts  settings.ts  albums.ts  tags.ts  pin.ts
    photos/   lifecycle.ts  uploads.ts  process.ts  query.ts  moderation.ts  downloads.ts
    social/   hearts.ts  comments.ts
    storage/  types.ts  disk.ts  s3.ts  index.ts  keys.ts
    imaging/  inspect.ts  heic.ts  render.ts
    live/     publish.ts  hub.ts
    exports/  names.ts  build.ts
    signs/    qr.ts  text.ts  templates.ts  render.ts
  jobs/      boss.ts  worker.ts  cleanup.ts
  auth/      server.ts  client.ts
  features/  (browser) upload-queue/  gallery/  photo/  tv/  host/  ui/
  app/       (public)/  e/[code]/  tv/[token]/  host/  api/
drizzle/     migrations
scripts/     load.ts  big-export.ts
tests/       unit/  integration/  e2e/  fixtures/  helpers/
```

Commands used by every task:
- Unit: `npx vitest run tests/unit/<file>`; integration: `npx vitest run tests/integration/<file>`; browser: `npx playwright test tests/e2e/<file>`
- Gate before each commit: `npm run check` (= `tsc --noEmit && eslint . && vitest run`), expected exit 0.
- Every task follows: write the tests listed, run them and see them fail for the missing code, implement, run them and see them pass, run the gate, commit with the given message.

---

## Stage 1: Foundation

### Task 1: Project, database and error handling

**Files:** Create `package.json`, `tsconfig.json`, `next.config.ts`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`, `src/config.ts`, `src/db/client.ts`, `src/lib/{errors,ids,route}.ts`, `src/app/layout.tsx`, `tests/helpers/db.ts`; Test `tests/unit/{config,ids,route}.test.ts`

**Interfaces – Produces:**
- `config: { appName, appUrl, databaseUrl, secret, storage, mail, google?, trustedProxyHops, limits }`
- `db`, `type Tx`, `withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`
- `class AppError extends Error { code: ErrorCode; status: number }`
- `ErrorCode = 'not_found'|'forbidden'|'pin_required'|'pin_wrong'|'pin_paused'|'frozen'|'gallery_full'|'guest_limit'|'rate_limited'|'too_large'|'bad_type'|'bad_input'|'feature_off'|'removed_by_host'|'conflict'|'internal'`
- `newEventCode(): string`, `newToken(): string`, `sha256Hex(s: string | Buffer): string`, `hmacHex(s: string): string`
- `route(fn): RouteHandler` converts Zod errors to `bad_input`, `AppError` to its status, anything else to a logged `internal`
- test helper `resetDb()`

- [ ] **Step 1:** `git init -b main` in the project folder, scaffold Next.js with Tailwind, install the stack plus `@opentelemetry/api`. Create databases `event_photos_dev` and `event_photos_test` with `createdb`.
- [ ] **Step 2: Tests**
  - config: missing `DATABASE_URL` throws naming it; `STORAGE_DRIVER=disk` with `NODE_ENV=production` throws.
  - ids: 10,000 `newEventCode()` values are unique and match `/^[1-9A-HJ-NP-Za-km-z]{12}$/`; `newToken()` decodes to 32 bytes.
  - route: an unexpected `Error('secret detail')` yields status 500, code `internal`, and a body not containing `secret detail`.
- [ ] **Step 3:** Implement. Choose base58 characters by rejection sampling, so there is no modulo bias.
- [ ] **Step 4:** `npm run check` passes; `npm run dev` serves `/` with 200.
- [ ] **Step 5:** Commit `chore: scaffold project`

### Task 2: Schema and migrations

**Files:** Create `src/db/schema.ts`, `drizzle/*`; Test `tests/integration/schema.test.ts`

**Interfaces – Produces:** Drizzle tables `events, participants, albums, photos, photoContributors, hashtags, photoHashtags, hearts, comments, exports, rateLimits`, and:
- `photoStatus` enum: `reserved, uploaded, processing, pending, live, hidden, failed, duplicate, expired, deleted`
- `events`: `ownerId` (nullable, set null when the user is deleted, so purge still happens), `code`, `tvToken`, `name`, `eventDate`, `timeZone`, `coverKey`, `welcome`, `accent`, `settings` jsonb, `pinHash`, `pinVersion`, `tvPinEncrypted` (nullable), `pinPausedUntil`, `frozenAt`, `maxPhotos`, `maxBytes`, `usedPhotos`, `usedBytes`, `deletedAt`
- `photos`: `clientId`, `participantId`, `albumId` (set null), `status`, `sizeBytes`, `sha256`, `mime`, `width`, `height`, `thumbhash`, `takenAt`, `reservedAt`, `uploadedAt`, `publishedAt`, `featured`, `heartCount`, `failureCode`, `deletedBy` (`host|uploader`), `duplicateOf`
- `EventSettings = { hearts: boolean; comments: boolean; guestDownloads: boolean; approval: boolean; defaultOrder: 'newest'|'taken'|'featured'; tv: { seconds: number; albumId: string|null; showNames: boolean; showQr: boolean; showPin: boolean } }`. Defaults: hearts, comments and guestDownloads true; approval false; newest; 7 seconds, all albums, names and QR on, PIN off.

- [ ] **Step 1: Tests**
  - Duplicate `(eventId, clientId)` is rejected.
  - Two `live` photos with equal `(eventId, sha256)` are rejected; the same with one `deleted`, `failed`, `expired` or `duplicate` is accepted; equal hashes in different events are accepted.
  - Two participants with the same `(eventId, tokenHash)`, and two hearts with the same `(photoId, participantId)`, are rejected.
  - Deleting an album sets its photos' `albumId` to null.
- [ ] **Step 2:** Implement with foreign keys cascading from `events`, plus gallery indexes `(eventId, status, publishedAt desc, id)`, `(eventId, status, takenAt desc, id)`, `(eventId, status, heartCount desc, id)`.
- [ ] **Step 3:** Tests pass; `npx drizzle-kit check` is clean. Commit `feat: add database schema`

### Task 3: Storage

**Files:** Create `src/modules/storage/*`, `src/app/api/storage/[...key]/route.ts`; Test `tests/integration/storage.contract.ts`, `storage-disk.test.ts`, `storage-s3.test.ts`

**Interfaces – Produces:**
```ts
interface ObjectStorage {
  signPut(o: { key: string; size: number; contentType: string }): Promise<{ url: string; headers: Record<string,string> }>
  signGet(key: string, o?: { downloadName?: string; now?: Date }): Promise<string>
  head(key: string): Promise<{ size: number } | null>
  read(key: string): Promise<Buffer>
  readStream(key: string): Promise<Readable>
  put(key: string, body: Buffer | Readable, contentType: string): Promise<{ size: number }>
  delete(keys: string[]): Promise<void>
  deletePrefix(prefix: string): Promise<void>
}
```
`storage: ObjectStorage`; `keys.incoming|original|thumb|display|download|cover|export(eventId, id, ext?)`, all under `ev/{eventId}/`.

- [ ] **Step 1: Contract tests** (disk always; S3 when `S3_TEST_*` is set)
  - Put then read is byte-identical; `head` of a missing key is null; deleting a missing key does not throw.
  - `signPut` for 10 bytes: sending 10 bytes succeeds, sending 11 is refused.
  - `signGet` at 10:05 and 10:55 is the same string, at 11:05 a different one; a URL from 10:05 is refused at 12:01.
  - `Range: bytes=5-9` returns 206 with exactly those bytes.
  - `deletePrefix('ev/A/')` leaves `ev/AB/` untouched.
  - Disk only: an altered signature, an expired URL and `../` in the key are each refused.
- [ ] **Step 2:** Implement. S3: `getSignedUrl` with `signingDate` at the start of the hour and `expiresIn: 7200`; PUT signs `content-length` and `content-type`; streams use `lib-storage` `Upload` with 16 MB parts. Disk: HMAC-signed URLs to the storage route, which returns 404 unless the disk driver is active.
- [ ] **Step 3:** Pass; commit `feat: add storage drivers`

### Task 4: Host accounts

**Files:** Create `src/auth/*`, `src/db/auth-schema.ts`, `src/lib/mail.ts`, `src/app/api/auth/[...all]/route.ts`, `src/app/(public)/{sign-in,sign-up,reset}/page.tsx`, `src/app/host/layout.tsx`; Test `tests/integration/auth.test.ts`, `tests/e2e/host-auth.spec.ts`

**Interfaces – Produces:** `getUser(headers): Promise<{ id; email; name; emailVerified } | null>`, `requireUser(headers)`, `sendMail({ to, subject, text }): Promise<void>` (console without SMTP config; tests read `testOutbox`).

- [ ] **Step 1: Tests**
  - Sign-up sends one verification email; the host area before verification shows "Check your email".
  - Reset for an unknown email returns the same response as for a known one.
  - Google button is absent without Google keys.
  - e2e: sign up, follow the emailed link, reach `/host`; `/host` signed out redirects to sign-in and returns afterwards to a same-site path only (`?next=https://evil.test` goes to `/host`).
- [ ] **Step 2:** Implement with Better Auth's Drizzle adapter; generate its tables with `npx auth generate`; forms with TanStack Form.
- [ ] **Step 3:** Pass; commit `feat: add host accounts`

---

## Stage 2: Events and access

### Task 5: Access, guests and PIN

**Files:** Create `src/modules/access/*`, `src/modules/events/pin.ts`, `src/lib/{rate-limit,ip}.ts`, `src/proxy.ts`, `src/app/api/e/[code]/{route,pin/route,me/route}.ts`; Test `tests/unit/can.test.ts`, `tests/integration/{viewer,pin,proxy}.test.ts`

**Interfaces – Produces:**
```ts
type Viewer =
  | { kind: 'host'; eventId: string; participantId: string; userId: string }
  | { kind: 'guest'; eventId: string; participantId: string }
  | { kind: 'locked'; eventId: string }            // PIN not passed
type Action = 'gallery.view'|'photo.upload'|'photo.heart'|'comment.create'|'photo.delete'
  |'comment.delete'|'photo.moderate'|'comment.moderate'|'photo.download'|'photo.original'
  |'album.manage'|'tag.manage'|'event.manage'|'export.run'
can(viewer, action, ctx: { event: EventRow; ownerIds?: string[] }): boolean   // pure
requireCan(...): void                                                          // throws the precise AppError
resolveViewer(o: { code: string } | { eventId: string }, req): Promise<{ event: EventRow; viewer: Viewer }>
setPin(tx, eventId, pin: string | null): Promise<void>
tryPin(event, guestTokenHash, ip, pin): Promise<void>
hitLimit(key, max, windowSec): Promise<boolean>;  peekLimit(key, max, windowSec): Promise<boolean>
clientIp(req): string
```
Guest cookie `qg` is set by `proxy.ts` on `/e/*` and forwarded on that same request. A participant row is created on the first unlocked API call.

- [ ] **Step 1: Tests**
  - `can`: one table-driven case per cell of spec section 4, for guest, host, locked guest, guest of another event and signed-in non-owner (treated as guest), each with frozen on/off, hearts and comments on/off, downloads on/off.
  - Locked GET of the event returns exactly `{ name, coverUrl, welcome, pinRequired: true }`.
  - A deleted event is `not_found` for guests and the TV.
  - PIN: the 6th try after 5 wrong is `rate_limited` even when correct; 50 different guests on one IP entering the right PIN all succeed; the 101st wrong attempt from one IP is `rate_limited`; the 500th wrong attempt in an event pauses it for 10 minutes and emails the host once; a guest already inside still works; changing the PIN locks them again.
  - The stored PIN is not `sha256(pin)`; it is an HMAC with the server secret and event ID.
  - Proxy: POST with a foreign `Origin` is 403; the first `/e/x` response sets `qg` HttpOnly SameSite=Lax; responses carry `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`; CSP has a nonce and allows only the storage origin for images and connections besides self, blob and data; `style-src-attr 'unsafe-inline'` is allowed because the virtualized gallery sets inline positions.
  - The event code is matched exactly; with `TRUSTED_PROXY_HOPS=1` a spoofed leftmost `X-Forwarded-For` is ignored.
- [ ] **Step 2:** Implement; compare PIN hashes in constant time. Check and increment limits in a single upsert.
- [ ] **Step 3:** Pass; commit `feat: add guest access and PIN`

### Task 6: Create and manage events, albums and tags

**Files:** Create `src/modules/events/{events,settings,albums,tags}.ts`, `src/app/api/host/events/**`, `src/app/host/**` (dashboard, create, event shell with tabs, Settings, Albums & tags); Test `tests/unit/tags.test.ts`, `tests/integration/events.test.ts`, `tests/e2e/host-events.spec.ts`

**Interfaces – Produces:**
- `createEvent(userId, input): Promise<EventRow>`; `updateEvent`, `updateSettings(eventId, patch)`, `setFrozen(eventId, boolean)`, `replaceCode(eventId)`, `replaceTvToken(eventId)`
- `createAlbum|renameAlbum|deleteAlbum(eventId, ...)`, `reorderAlbums(eventId, ids[])`
- `parseTags(raw: string[]): { norm: string; display: string }[]`; `attachTags(tx, eventId, photoId, tags)` (skips blocked); `suggestTag|unsuggestTag|blockTag(eventId, ...)`; `trendingTags(eventId, now): Promise<{ norm; display; count }[]>`

- [ ] **Step 1: Tests**
  - `parseTags(['#BrideSquad','bridesquad',' #Niño ','#a b','','#'+'x'.repeat(41)])` gives `bridesquad` (display `BrideSquad`) and `niño` only; 11 distinct tags keep the first 10.
  - Unverified host and an 11th event are refused; an invalid time zone is `bad_input`.
  - Every host route returns `not_found` for another host's event and for an album ID belonging to another event.
  - `reorderAlbums` with a missing or foreign ID is `bad_input` and changes nothing.
  - `blockTag` removes it from all photos, and `attachTags` then skips it.
  - Trending ranks by photos in the last 2 hours, then total.
  - e2e: create an event with two albums and a PIN; rename, reorder and delete an album; replacing the link warns "Printed QR codes will stop working" and the old link then shows not found.
- [ ] **Step 2:** Implement with TanStack Form and Query; keyboard-operable reorder buttons. Cover upload is wired in Task 8.
- [ ] **Step 3:** Pass; commit `feat: add event management`

---

## Stage 3: Photos

### Task 7: Imaging

**Files:** Create `src/modules/imaging/*`, `tests/fixtures/*` (made with sharp and `sips`, committed); Test `tests/unit/imaging.test.ts`

**Interfaces – Produces:**
- `inspect(buf): Promise<{ format: 'jpeg'|'png'|'webp'|'heic'|'avif'; mime; ext; width; height; takenLocal: string|null; offset: string|null }>` throws `bad_type`
- `render(buf, format): Promise<{ thumb: Buffer; display: Buffer; thumbhash: string; width; height }>`
- `renderDownload(buf, format): Promise<Buffer>` (full-size JPEG, quality 95)
- `resolveTakenAt({ takenLocal, offset, timeZone, uploadedAt }): Date`

- [ ] **Step 1: Tests**
  - Formats detected for all five types; a PDF, an SVG, a GIF, HTML renamed `.jpg`, an empty file and a truncated JPEG are `bad_type`; a 101-megapixel PNG is refused without decoding it.
  - A P3 JPEG and its HEIC conversion both give center pixels within 3 of sRGB `[220, 59, 40]`.
  - An EXIF orientation 6 photo of 4032x3024 gives a 360x480 thumb and 1536x2048 display; images smaller than 480 are not enlarged.
  - All outputs have no EXIF, GPS or ICC; `renderDownload` has full pixel size.
  - `resolveTakenAt`: `2026:06:12 18:45:01` in `Asia/Manila` gives `2026-06-12T10:45:01Z`; an EXIF offset wins over the event zone; missing, malformed, or over 24 hours after upload gives the upload time; a nonexistent DST-gap local time does not throw.
- [ ] **Step 2:** Implement with `limitInputPixels: 100_000_000` and `.timeout({ seconds: 30 })`; run the libheif decode in a worker thread terminated after 30 s. HEIC color method (tested):
```ts
// decode to RGBA with libheif, then give the pixels back their ICC profile so sharp converts to sRGB
let png = await sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 0 }).toBuffer()
const { icc } = await sharp(heic).metadata()
if (icc) png = Buffer.concat([png.subarray(0, 33), pngChunk('iCCP',
  Buffer.concat([Buffer.from('icc\0\0', 'latin1'), zlib.deflateSync(icc)])), png.subarray(33)])
// pngChunk: uint32 length, type, data, zlib.crc32(type + data)
```
- [ ] **Step 3:** Pass; commit `feat: add image processing`

### Task 8: Uploads and processing

**Files:** Create `src/modules/photos/{lifecycle,uploads,process}.ts`, `src/jobs/{boss,worker}.ts`, `src/app/api/e/[code]/uploads/**`, `src/app/api/host/events/[id]/cover/route.ts`; Test `tests/unit/lifecycle.test.ts`, `tests/integration/{uploads,process}.test.ts`

**Interfaces – Produces:**
- `transition(tx, photoId, from: PhotoStatus[], to: PhotoStatus): Promise<boolean>`
- `reserveUpload(viewer, event, input: { clientId; size; mime; albumId?; tags: string[]; name? }): Promise<{ photoId; state: UploadState; put?: { url; headers } }>`
- `completeUpload(viewer, event, photoId): Promise<{ state: UploadState }>`; `uploadStates(viewer, event, photoIds[])`
- `UploadState = 'reserved'|'processing'|'live'|'pending'|'already_added'|'received'|'failed'|'removed_by_host'`
- `processPhoto(photoId): Promise<void>`; `enqueue(tx, 'photo.process'|'photo.purge'|'export.build', data)`

- [ ] **Step 1: Tests**
  - Lifecycle: every arrow in the spec diagram is allowed; every other pair is refused.
  - Reserving twice with one `clientId` gives one row and one quota charge; after expiry it is reserved again under the same ID; another guest reusing that ID gets `conflict`.
  - 20 concurrent reservations with room for 5 succeed exactly 5 times; the rest are `gallery_full`.
  - 40 MB + 1 byte is `too_large`; the 501st photo is `guest_limit`; the 61st reservation in a minute is `rate_limited`.
  - **Review Focus 1:** reserving with a deleted album, another event's album, or a blocked tag succeeds without it.
  - Complete before the file exists, or with the wrong size, is `bad_input`; completing twice queues one job.
  - Freeze: reserved before, completed at +9:59, succeeds; at +10:01 it is `frozen`; a new reservation is `frozen`; the host can still upload.
  - Process: the original in storage has the same SHA-256 as the fixture; the incoming file is gone; re-sending to the old upload URL does not change the original.
  - Running `processPhoto` twice, or crashing it after the storage writes, ends with one live photo.
  - Approval on gives `pending` for a guest and `live` for the host.
  - Duplicates: same guest `already_added`; another guest `received` with two contributors, and the same answer when the first is hidden or pending; two at once give one photo; host-deleted gives `removed_by_host`; uploader-deleted is accepted. Each releases its quota.
  - Three failed attempts give `failed` with the quota released.
  - A cover passes the same checks and does not change `usedPhotos` or `usedBytes`.
- [ ] **Step 2:** Implement. Quota: one conditional `UPDATE ... WHERE used + $n <= max RETURNING`. Duplicate check: `pg_advisory_xact_lock` on hash of `(eventId, sha256)`, with the unique index as backstop. `photo.process`: retryLimit 3 with backoff, concurrency 2.
- [ ] **Step 3:** Pass; commit `feat: add upload pipeline`

### Task 9: Gallery queries and downloads

**Files:** Create `src/modules/photos/{query,downloads}.ts`, `src/app/api/e/[code]/photos/**`; Test `tests/integration/{query,downloads}.test.ts`

**Interfaces – Produces:**
- `PhotoDto = { id; status; thumbUrl; displayUrl; width; height; thumbhash; takenAt; publishedAt; uploader: string; albumId; tags: string[]; featured; heartCount?; hearted?; commentCount?; mine: boolean; canDelete: boolean; canDownload: boolean }`
- `View = { kind: 'all'|'hearted'|'featured'|'mine' } | { kind: 'album'; id } | { kind: 'tag'; norm } | { kind: 'waiting'|'hidden'|'failed' }` (last three host only)
- `listPhotos(viewer, event, { view, order, cursor, limit = 60 }): Promise<{ items: PhotoDto[]; next: string|null }>`
- `getPhotos(viewer, event, ids[]): Promise<{ items: PhotoDto[]; gone: string[] }>`
- `downloadUrl(viewer, event, photoId, { original?: boolean }): Promise<string>`

- [ ] **Step 1: Tests**
  - A visibility matrix of all ten statuses by guest, uploader and host matches spec section 5; invisible IDs appear in `gone` the same way as nonexistent ones.
  - Paging 150 photos with equal timestamps returns each once, also when new photos arrive between pages; a tampered cursor is `bad_input`.
  - Each order and view returns the right set; `hearted` is `feature_off` when hearts are off, and counts are absent from the DTO.
  - A blank name shows "Guest"; renaming changes earlier photos' uploader.
  - Guest download has no GPS; a guest asking for the original is `forbidden`; downloads off is `forbidden` for a guest but works for the host; a second request does not re-render.
- [ ] **Step 2:** Implement with keyset cursors; pass; commit `feat: add gallery queries`

### Task 10: Guest gallery and photo viewer

**Files:** Create `src/app/e/[code]/page.tsx`, `src/features/{gallery,photo,ui}/**`, `src/app/globals.css`; Test `tests/e2e/gallery.spec.ts`

**Interfaces – Produces:** query keys `qk.event(code)`, `qk.photos(code, view, order)`, `qk.comments(photoId)`; `patchPhotos(client, code, { items, gone })`; `<PhotoImage photo size>` which refetches once when an image fails to load.

- [ ] **Step 1: Tests** (Chromium and WebKit, 390x844)
  - A PIN event shows the cover, name and welcome, then the gallery after the right PIN.
  - Chips (All, albums, trending tags, Most Hearted, Featured) switch views and the URL keeps the choice after reload; order can be switched; Most Hearted is absent when hearts are off.
  - The viewer's Download saves a JPEG and is absent when downloads are off; Delete shows only on own photos, with the note about clearing browser data.
  - 500 photos scroll to the end with fewer than 120 thumbnails in the DOM at any time.
  - The viewer opens, swipes, closes with Back and with Escape, and returns focus to the thumbnail.
  - Frozen shows "Uploads are closed" and no Add button.
  - **Review Focus 5:** an empty event says "Be the first to add a photo".
  - **Review Focus 3:** make the image URLs return 403 once; the images appear after an automatic refetch, with no endless loop when they keep failing.
  - No axe violations on the gallery, PIN and viewer screens.
- [ ] **Step 2:** Implement per spec section 9, loading the `frontend-design` skill first; virtualized rows with `useWindowVirtualizer`.
- [ ] **Step 3:** Pass; view screenshots at 390 and 1280 wide; commit `feat: add guest gallery`

---

## Stage 4: Unreliable signal and live updates

### Task 11: Upload queue and add-photos sheet

**Files:** Create `src/features/upload-queue/{types,store,transport,queue,use-queue}.ts`, `src/features/gallery/add-sheet.tsx`, `upload-bar.tsx`; Test `tests/unit/upload-queue.test.ts` (fake-indexeddb, fake clock and transport), `tests/e2e/upload.spec.ts`

**Interfaces – Produces:**
```ts
type ItemState = 'waiting'|'uploading'|'offline'|'added'|'waiting_for_host'|'failed'|'closed'|'needs_access'
interface QueueItem { clientId; eventId; code; fileName; size; meta; state; progress; attempts; reason?; photoId? }
class UploadQueue {
  add(files: File[], meta): Promise<{ persisted: boolean }>
  items(): QueueItem[];  subscribe(fn): () => void
  retry(id): void;  remove(id): Promise<void>
  resumeAccess(eventId, code): void
  start(): void;  stop(): void
}
```
`Transport = { reserve, put(url, headers, blob, onProgress, signal), complete, states }`

- [ ] **Step 1: Unit tests**
  - The file is stored before the first transport call; a new queue on the same store resumes it.
  - At most two run at once; backoff bounds are 1–2 s, 2–4 s, 4–8 s, capped at 60 s; the `online` and `visibilitychange` events retry at once.
  - A 403 from an expired upload URL reserves again with the same `clientId`.
  - `added` only after `complete` succeeds; the stored file is kept until the server reports `live`, `pending`, `already_added` or `received`; a later `failed` turns the item to `failed` and it can be retried.
  - `frozen` gives `closed` and resumes after the event reopens; `bad_type`, `too_large`, `gallery_full`, `guest_limit` and `removed_by_host` give `failed` without retrying; `rate_limited` and 5xx retry.
  - **Review Focus 2:** `pin_required` or `not_found` gives `needs_access` with all files kept; `resumeAccess` with a new code finishes them.
  - Full storage (`QuotaExceededError`) returns `persisted: false` and still uploads.
  - Two queues on one store send each file once; without Web Locks, a stored lease is used.
  - Adding 200 files writes one at a time and never reads a file until its turn.
- [ ] **Step 2: e2e:** choose 5 photos with an album, tag and name and see them in the gallery; go offline mid-upload, see "No signal, will retry", come back, all 5 arrive; reload mid-upload, all arrive exactly once; the "Keep this page open" and location notes are visible.
- [ ] **Step 3:** Implement. Library input `accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif" multiple`; camera input with `capture="environment"`; XHR for progress; previews from object URLs, revoked after use.
- [ ] **Step 4:** Pass; commit `feat: add resilient uploads`

### Task 12: Live updates

**Files:** Create `src/modules/live/*`, `src/app/api/e/[code]/stream/route.ts`, `src/features/gallery/use-live.ts`; Modify the mutating functions from Tasks 5, 6 and 8 to publish; Test `tests/integration/live.test.ts`, `tests/e2e/live.spec.ts`

**Interfaces – Produces:**
- `LiveMessage = { eventId; type: 'photos'|'event'|'comments'|'hearts'|'access'|'export'; ids: string[]; audience: 'everyone'|'host'|string[] }` (`string[]` is participant IDs; the host always receives)
- `publish(tx, msg): Promise<void>` (`pg_notify` in the transaction, at most 100 IDs per message)
- `hub.subscribe(eventId, viewer, send): () => void`

- [ ] **Step 1: Tests**
  - A rolled-back transaction delivers nothing; a committed one delivers once.
  - A pending photo reaches its uploader and the host, not another guest; approval reaches everyone; hiding delivers the ID and `getPhotos` lists it in `gone`.
  - Changing the PIN closes guests' streams at once; deleting the event closes all.
  - 250 IDs arrive as 3 messages; 50 hearts in 2 s give one message per stream.
  - A killed listener connection reconnects, and clients are told to refetch.
  - Closing the browser request removes the subscription (count returns to 0).
  - e2e: guest B sees guest A's photo within 5 s without reloading; scrolled down, B sees "1 new photo" and the scroll position stays put; with the stream blocked, the photo appears within 20 s by polling.
- [ ] **Step 2:** Implement: keep the hub on `globalThis`, since Next.js can load a module once per route bundle; one `LISTEN` client per process, heartbeat every 20 s, `X-Accel-Buffering: no`; browser batches `getPhotos` once a second and refetches on every connect.
- [ ] **Step 3:** Pass; commit `feat: add live updates`

---

## Stage 5: Social and moderation

### Task 13: Hearts and comments

**Files:** Create `src/modules/social/*`, API routes, `src/features/photo/{heart,comments}.tsx`; Test `tests/integration/social.test.ts`, `tests/e2e/social.spec.ts`

**Interfaces – Produces:** `setHeart(viewer, event, photoId, on): Promise<{ heartCount }>`; `addComment(viewer, event, photoId, { text, name? }): Promise<CommentDto>`; `listComments(viewer, event, photoId, cursor?)`; `deleteComment`, `hideComment(viewer, event, id, hidden)`; `CommentDto = { id; author; text; createdAt; mine; canDelete; hidden }`

- [ ] **Step 1: Tests**
  - 20 concurrent hearts from one guest give `heartCount` 1; from 20 guests, 20; unheart twice never goes below 0.
  - Hearts or comments on a photo the viewer cannot see are `not_found`; feature off is `feature_off`; frozen is `frozen` for guests and allowed for the host; turning the feature on again shows the old ones.
  - 501 characters and blank text are `bad_input`; the 11th comment in a minute is `rate_limited`.
  - Guests delete only their own comments; hidden comments are invisible to guests, including the author.
  - **Review Focus 4:** name `<script>alert(1)</script>`, `שלום 🎉` and 40 emoji render as text with no layout overflow and no dialog.
- [ ] **Step 2:** Implement with optimistic updates that roll back on error; pass; commit `feat: add hearts and comments`

### Task 14: Moderation, approval and freeze

**Files:** Create `src/modules/photos/moderation.ts`, host Photos and Waiting tabs, host tools in the guest gallery; Test `tests/integration/moderation.test.ts`, `tests/e2e/moderation.spec.ts`

**Interfaces – Produces:** `moderate(viewer, event, ids: string[], op: { kind: 'approve'|'hide'|'unhide'|'delete'|'feature'|'unfeature' } | { kind: 'move'; albumId: string|null }): Promise<{ changed: string[] }>`; `approveAll(viewer, event)`; `deleteOwnPhoto(viewer, event, photoId)`

- [ ] **Step 1: Tests**
  - One foreign ID in a bulk call is `not_found` and changes nothing; 200 IDs work, 201 is `bad_input`.
  - Hiding a pending photo then unhiding makes it `live`; turning approval off leaves photos pending; `approveAll` publishes them with new `publishedAt`.
  - Guest deletes own with two contributors: the photo stays, the uploader becomes the second, and the first no longer sees `mine`. The last contributor's delete removes it with its hearts and comments, releases quota and queues file removal.
  - A non-owner guest deleting is `forbidden`; deleting one's own works while frozen; a `processing` photo can be deleted and does not come back.
  - Host delete removes the stored original, versions and cached download.
  - e2e: approval on, guest uploads and sees "Waiting for host", another guest does not see it, the host approves, it appears live; freezing changes an open guest screen without reload.
- [ ] **Step 2:** Implement; host grid with keyboard multi-select; delete confirms with the count. Pass; commit `feat: add moderation`

---

## Stage 6: QR, signs and TV

### Task 15: QR codes and share page

**Files:** Create `src/modules/signs/qr.ts`, host Share tab, QR routes; Test `tests/unit/qr.test.ts`

**Interfaces – Produces:** `eventUrl(code): string`, `qrSvg(url, { dark? }): string`, `qrPng(url, size): Promise<Buffer>`

- [ ] **Step 1: Tests:** `qrPng` is 2048x2048 and jsQR decodes it to exactly `eventUrl(code)`; the rasterized SVG decodes too; an accent color with contrast under 4.5:1 against white falls back to black; the quiet zone is 4 modules; a non-owner gets `not_found`.
- [ ] **Step 2:** Implement with error correction M; pass; commit `feat: add QR codes`

### Task 16: Printable signs

**Files:** Create `src/modules/signs/{text,templates,render}.ts`, `src/features/host/sign-editor.tsx`; Test `tests/unit/signs.test.ts`, `tests/e2e/signs.spec.ts`

**Interfaces – Produces:**
- `SignSize = 'a6'|'4x6'|'a4'|'letter'|'screen'`; `SignStyle = 'classic'|'modern'|'bold'`
- `textToPath(text, { font, size, maxWidth, maxLines }): { d: string; lines: number; fontSize: number }` (opentype.js with bundled font files, so output never depends on installed fonts)
- `unsupportedGlyphs(text, font): string[]`
- `signSvg(o: { size; style; headline; subtext; accent; url; pin?: string }): string`
- `signPng(o, { preview?: boolean }): Promise<Buffer>`, `signPdf(o): Promise<Uint8Array>`

The editor's preview is `signPng(..., { preview: true })`, so preview and download share one renderer.

- [ ] **Step 1: Tests**
  - For all 15 size and style pairs: the QR decodes from the final render, with and without PIN; PDF pages measure A6 298x420 pt, 4x6 288x432, A4 595x842, Letter 612x792 (±1); `screen` is 1920x1080.
  - A 60-character headline shrinks and wraps inside the margins; 61 is `bad_input`.
  - **Review Focus 4:** `unsupportedGlyphs('Ana 🎉 Niño')` is `['🎉']`; the sign leaves it out and the editor names the missing character.
  - Preview and full render of the same options differ by under 2% of pixels after scaling.
  - `pin` shows only when the host chose it and the event has one. The PIN is stored hashed, so the host types it for the sign; it is checked against the hash and never saved.
- [ ] **Step 2:** Implement at 300 dpi with pdf-lib; pass; look at all 15 renders; commit `feat: add printable signs`

### Task 17: TV mode

**Files:** Create `src/app/tv/[token]/page.tsx`, `src/app/api/tv/[token]/{route,stream/route}.ts`, `src/features/tv/{slides,tv}.ts(x)`; Test `tests/unit/slides.test.ts`, `tests/e2e/tv.spec.ts`

**Interfaces – Produces:** `slidesReducer(state: { queue: PhotoDto[]; fresh: PhotoDto[]; index: number }, action: 'tick' | { add } | { remove } | { replace })`; `current(state): PhotoDto | null`

- [ ] **Step 1: Tests**
  - Fresh photos show next, oldest first, then cycling continues where it was; removing the photo on screen advances at once; one photo stays put; none gives null.
  - The API returns only `live` photos of the chosen album; names are absent when off; replacing the token closes the stream and the old link is not found.
  - "Show PIN" is the one case that needs the plain PIN: the host enters it in TV settings, it is verified, and stored in `tvPinEncrypted` (AES-256-GCM with the server secret). This is the only departure from "hash only" in the spec, and happens only if the host turns it on. Turning it off or changing the PIN erases it.
  - e2e: an uploaded photo shows within 10 s and leaves within 2 s of being hidden; offline, the slideshow keeps cycling loaded photos; **Review Focus 5:** no photos shows the event name, a large QR and "Scan to add the first photo"; **Review Focus 3:** after the clock jumps 3 hours, images still load; reduced motion has no crossfade.
- [ ] **Step 2:** Implement; preload the next image before advancing; wake lock re-requested when visible; at most 200 photos kept in memory. Pass; commit `feat: add TV mode`

---

## Stage 7: Export, deletion and limits

### Task 18: ZIP export

**Files:** Create `src/modules/exports/*`, host Export tab and routes; Test `tests/unit/export-names.test.ts`, `tests/integration/export.test.ts`, `tests/e2e/export.spec.ts`, `scripts/big-export.ts`

**Interfaces – Produces:** `exportPath(p: { album: string|null; takenAt: Date; timeZone; uploader; seq: number; ext }): string`; `startExport(viewer, event, { includeHidden, includePending }): Promise<ExportRow>` (stores the photo IDs at click time); `buildExport(exportId): Promise<void>`; `exportDownloadUrl(viewer, event, exportId)`

- [ ] **Step 1: Tests**
  - `exportPath` for Dance Floor, Ana, Manila and sequence 1 is `Dance Floor/2026-06-12_184501_Ana_0001.jpg`; no album goes to `No album/`.
  - **Review Focus 4:** names `../../x`, `CON`, `a/b:c*?`, trailing dots, emoji and 40 wide characters give valid Windows and Mac paths, at most 180 bytes, no collisions, and no entry outside the root.
  - The built ZIP, read with yauzl, holds files with SHA-256 equal to the uploads; a photo deleted after the click is left out; one added after is not included; a missing original goes to `_errors.txt` and the rest succeed.
  - A second start while one runs returns the running one; **Review Focus 5:** zero photos is refused with "There are no photos to download yet."; a crashed job restarts and finishes; the finished link supports Range; after 7 days it is `not_found` and the file is removed.
  - e2e: click, watch progress, the download begins and one email is sent.
- [ ] **Step 2:** Implement: `new ZipArchive({ store: true })` piped to `storage.put`, one original streamed at a time; progress published at most once a second.
- [ ] **Step 3:** Pass; commit `feat: add ZIP export`

### Task 19: Cleanup, deletion and limit notices

**Files:** Create `src/jobs/cleanup.ts`; Modify event settings, dashboard, account page; Test `tests/integration/cleanup.test.ts`, `tests/e2e/delete.spec.ts`

**Interfaces – Produces:** `runCleanup(now: Date): Promise<void>` (hourly); `deleteEvent`, `restoreEvent(userId, eventId)`; account deletion hook

- [ ] **Step 1: Tests**
  - Reservations over 24 h become `expired` with quota released and the incoming file removed; the guest can resume with the same ID.
  - A deleted event is gone for guests and the TV at once, restorable on day 6, and on day 8 its rows and every object under `ev/{id}/` are gone while another event's remain.
  - Account deletion requires the password (or a fresh Google sign-in), locks all events at once, and they are purged on day 8 though the user row is gone.
  - 89% of either limit shows no banner, 90% does; 100% shows guests "This gallery is full".
  - Rate-limit rows older than a day are removed. Running cleanup twice, or two at once, is harmless.
- [ ] **Step 2:** Implement; pass; commit `feat: add cleanup and deletion`

---

## Stage 8: Finish

### Task 20: Public pages and health

**Files:** Create `src/app/(public)/{page,privacy/page,terms/page,report/page}.tsx`, `src/app/health/route.ts`, error and not-found pages; Test `tests/e2e/public.spec.ts`, `tests/integration/health.test.ts`

- [ ] **Step 1: Tests:** home leads to sign-up; privacy and terms show "Placeholder: have this reviewed before launch"; the report page shows `REPORT_EMAIL`; `/health` is 200 when all is well, and 503 naming `database`, `storage` or `worker` (heartbeat older than 60 s) when not, without revealing details; the not-found page gives the same response for a wrong code and a deleted event; no axe violations.
- [ ] **Step 2:** Implement (load `frontend-design` first); pass; commit `feat: add public pages and health`

### Task 21: Load, full journeys and deployment files

**Files:** Create `scripts/load.ts`, `Dockerfile`, `docs/setup.md`, `README.md`, `tests/e2e/journey.spec.ts`

- [ ] **Step 1:** Journey test: host creates an event with a PIN and approval; two guests join, upload, heart and comment; the host approves, hides one, freezes, exports; the ZIP matches.
- [ ] **Step 2:** `scripts/load.ts` against the production build: 200 streams, 500 uploads/hour for 10 minutes. Pass when the 95th percentile from complete to seen is under 5 s and memory is steady. Record the numbers in `README.md`.
- [ ] **Step 3:** `scripts/big-export.ts`: 10 GB export; interrupt the download at 40%, resume with Range, verify the SHA-256. Needs about 25 GB of free disk; check first, and stop and report if it isn't there.
- [ ] **Step 4:** Lighthouse on the gallery with simulated Fast 4G: first thumbnails under 2.5 s.
- [ ] **Step 5:** `docs/setup.md`: server, Postgres (direct connection, because `LISTEN` does not work through a transaction pooler), R2 bucket with its CORS rules, SMTP, Google, domain and HTTPS, migrations, starting `web` and `worker`, backups, real-phone checklist, and running the S3 contract tests against real R2. The Dockerfile cannot be built here without Docker; say so in the report.
- [ ] **Step 6:** `npm run check`, the full Playwright suite and `next build` all pass. Commit `chore: add load tests and setup guide`
