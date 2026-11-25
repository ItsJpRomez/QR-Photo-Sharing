# Live QR Event Photo Sharing: Design

Status: **approved** · 2026-11-25

Items marked **[call]** were decided by Claude, not requested. Change any of them.

## 1. Intent

Hosts spend the weeks after an event chasing guests for photos across messaging apps, and what arrives is compressed. This app gives the event one QR code. Guests scan it and add original-quality photos from the phone browser, with no app and no account. The gallery fills live during the event, and afterwards the host downloads everything in one archive.

It is a public product: anyone can sign up as a host and run their own events.

### Goals

- Guests go from scan to their first photo uploading with no install or sign-up.
- Uploads survive bad venue signal.
- Other guests' screens update without refreshing.
- The host stays in control: privacy, moderation, feature toggles, freeze and export.
- Originals are kept byte for byte.

### What success looks like **[call]**

- With 200 connected guests and 500 uploads an hour, a photo appears on other screens within 5 seconds of finishing its upload (95th percentile).
- The gallery shows its first thumbnails within 2.5 seconds on simulated Fast 4G.
- Dropping the network mid-upload, or reloading the page, loses no queued photo. The known exceptions are in section 6.
- A 10 GB export completes, and an interrupted download can resume.

### Not in this version

Video, payments and plans, native apps, face recognition, co-hosts, languages other than English, near-duplicate detection, a separate guestbook page, and an operator admin panel.

### Would make it a failure even if it works

- Asking guests to register before they can look or upload.
- Silently losing a photo, or showing "uploaded" when it isn't safe.
- Showing a hidden or unapproved photo to guests or on the venue screen.
- Publishing the GPS location in a guest's photo to other guests.

## 2. Approaches considered

1. **Always-on server (chosen).** Next.js and a background worker on Railway, Fly or a VPS, with Postgres and Cloudflare R2. Fewest services, any size of ZIP, and it runs locally. The cost is looking after a server.
2. **Vercel + Neon + R2 + hosted realtime + hosted jobs.** Easiest deploys. Function limits make large ZIPs and HEIC conversion awkward, with more vendors and bills.
3. **Supabase + worker.** Login and realtime are included. Guest and PIN access rules would exist twice, and a worker is still needed.

Option 1 was chosen because the hard parts are long jobs and open connections.

## 3. Architecture

```
 Phone / laptop / projector
   |  pages, API, live stream          |  photo bytes (signed URLs)
   v                                   v
 +-----------------+             +----------------------+
 | web  (Next.js)  |             | object storage       |
 |                 |             | R2, or local disk    |
 +--------+--------+             +----------^-----------+
          | SQL, NOTIFY/LISTEN              | reads and writes
          v                                 |
 +-----------------+   jobs (pg-boss)  +----+-----------+
 | Postgres        |<----------------->| worker         |
 +-----------------+                   +----------------+
```

- **web** serves pages, the JSON API and live streams. Photo bytes never pass through it in production.
- **worker** validates and converts photos, builds ZIPs, and runs cleanup.
- Both run from one repository with one set of modules.

### Stack

| Part | Choice | Source |
|---|---|---|
| App | Next.js 16 App Router, React 19, TypeScript strict | yours |
| Database access | Drizzle ORM 0.45 with `pg` | yours |
| TanStack | Query for data, Virtual for the gallery, Form for host forms | yours; these three are **[call]** |
| Database | Postgres 18 | approach 1 |
| Photo storage | Cloudflare R2 through the S3 API | approach 1 |
| Host login | Better Auth 1.7 | **[call]** |
| Jobs | pg-boss 12, so no Redis | **[call]** |
| Images | sharp, with libheif (WASM) for HEIC | **[call]** |
| UI | Tailwind 4 | **[call]** |
| Tests | Vitest 5, Playwright | **[call]** |

These were the current published versions on 2026-11-25, and their declared peer and engine ranges agree with each other and with the Node 26 installed here. Local Postgres 18 is running.

### Local development

Docker is not installed, so local development uses the installed Postgres and a **local-disk storage driver**. It sits behind the same interface as R2, with signed upload and download routes in the app. One shared test suite runs against the disk driver always, and against an S3 endpoint when credentials are present. The disk driver refuses to start in production.

Email prints to the console locally. Google sign-in appears only when its keys are set.

### Module boundaries

| Module | Responsibility | Does not know about |
|---|---|---|
| `access` | Who is asking, and what may they do? The only place permissions are decided. | HTTP, storage |
| `events` | Events, settings, albums, hashtags | Photos' bytes |
| `photos` | Photo lifecycle, queries and moderation | HTTP |
| `social` | Hearts and comments | Storage |
| `storage` | Sign, read, write, copy, delete | Events, people |
| `live` | Publish changes and fan them out to streams | Rendering |
| `imaging` | Bytes in, checked and resized images out | Database |
| `exports` | Build an archive from a list of photos | HTTP |
| `upload-queue` (browser) | Persist, send, retry | Gallery UI |

Route handlers only parse input (Zod), call `access`, call a module, and return.

## 4. People and access

**Host:** signs in with email and password (verified address, reset by email) or Google. The email must be verified before creating an event. Owns events; one owner per event.

**Guest:** on first visit the browser gets a random 256-bit token in an HttpOnly, SameSite=Lax cookie, Secure everywhere except local development. The database stores only its hash. There is one participant record per event. The first name is optional (40 characters); blank shows as "Guest". Changing it updates that guest's earlier contributions.

Clearing cookies, or moving from an in-app browser to Safari, makes a new guest. That person can no longer delete earlier uploads and must ask the host. The app says so next to the delete option.

**Signed-in host opening their own event link** gets the guest gallery with host tools.

| Action | Guest | Host |
|---|---|---|
| View live photos | with link, and PIN if on | yes |
| Upload, choose album and tags | until frozen | always |
| Heart, comment | when that feature is on and not frozen | when that feature is on |
| Delete own photo or comment | always | yes |
| Delete or hide anyone's photo or comment | no | yes |
| Download one photo | if allowed | always |
| Create, rename, delete, reorder albums | no | yes |
| Move a photo to another album, feature it | no | yes |
| Settings, approval, freeze, export | no | yes |

### Private access

- The event link has a 12-character random code (about 70 bits), is not indexed, and sends no referrer. The host can replace it, after a warning that printed QR codes will stop working.
- The optional **4-digit PIN** is stored as a keyed hash. Changing it makes every guest enter the new one.
- Until the PIN is entered, the server returns only the event name, cover and welcome message.
- **Wrong-PIN limits [call]:** 5 per guest browser per 15 minutes, 100 per IP per hour, and 500 per event per hour. Only wrong attempts count, because all guests at a venue may share one IP. Reaching the event limit pauses new PIN entries for 10 minutes and alerts the host; guests already inside are unaffected.
- Storage is private. Image URLs are signed, with the same URL reused for one hour so browsers can cache it, and they expire within two hours. Removing a photo takes it off every open screen at once; a URL someone already copied can work until it expires. Deleting also removes the files.

## 5. Photos

### Lifecycle

```
 reserved -> uploaded -> processing -+-> pending (approval on) --> live <--> hidden
     |                      |        +-> live (approval off)
     v                      v
  expired (24 h)       failed / duplicate          any -> deleted
```

- Guests see `live` photos. An uploader also sees their own `processing` and `pending` ones, with a badge. A hidden photo disappears for its uploader too. The host sees everything except expired and deleted.
- Turning approval off leaves waiting photos waiting; the host gets **Approve all**. Host uploads skip approval.
- `deleted` removes the photo at once, with its hearts and comments. A job removes the files.

### Upload steps

1. **Reserve.** The browser sends a unique ID, size, type, album, tags and name. The server checks permission, freeze and limits, reserves space in one transaction, and returns a signed upload URL for a temporary key.
2. **Send** straight to storage. The signature fixes the exact size.
3. **Complete.** The server confirms the file exists with the reserved size, then queues processing.
4. **Process.** The worker identifies the type from the bytes, hashes them (SHA-256), and checks for a duplicate. It makes the display sizes and writes those exact validated bytes to a permanent key. The temporary file is deleted, so a still-valid upload URL can never replace an approved photo.

Every step can be repeated safely with the same ID. A queue that resumes after its reservation expired reserves again with the same ID. Space reserved for expired, failed or duplicate uploads is released.

Event covers use the same checks and resizing, but aren't gallery photos, aren't exported and don't count toward limits.

**Accepted:** JPEG, PNG, WebP, HEIC/HEIF and AVIF, up to 40 MB and 100 megapixels **[call]**. The file picker lists HEIC explicitly so iPhones can send originals instead of converting them. Live Photos keep the still image only.

**Versions made:** 480 px thumbnail and 2048 px display image (long edge, WebP, correctly rotated), plus a tiny blurred placeholder. They carry no metadata. Originals are never modified.

**Time taken** comes from the photo's EXIF. EXIF usually lacks a time zone, so the event's time zone is assumed. If missing, or over a day in the future, the upload time is used.

**Guest downloads** are a full-resolution JPEG with location and other metadata removed, made on first request and cached **[call]**. Only the host gets untouched originals, which may contain GPS. The upload screen states this in one line.

### Duplicates

Byte-identical photos in the same event are stored once.

- Same guest again: shows as already added.
- Another guest: shows as received, and the first copy keeps its uploader, album and tags. Both are recorded as contributors, so if the first guest deletes it, the photo stays under the other guest's name instead of vanishing. It goes away when no contributor is left. The message never reveals whether the first copy is hidden or waiting.
- Previously deleted by the host: refused, so removed photos can't come straight back.
- Previously deleted by all its contributors: accepted again.

### Limits **[call]**

Per event: 5,000 photos and 25 GB of originals. Per host: 10 events. They live in configuration, with a per-event override column, ready for paid plans. Host sees a banner at 90%; at 100% guests see "This gallery is full".

Per guest: 500 photos per event, 60 upload reservations a minute, 10 comments a minute.

### Freeze

Guests can look, download (if allowed) and delete their own work; they cannot upload, heart or comment. Files already reserved get 10 minutes to finish. Anything else still queued stays on the phone with "The host closed uploads" and resumes if the host reopens.

## 6. Unreliable signal

- Chosen files are saved in the browser (IndexedDB) **before** any network call, so a reload or crash doesn't lose them.
- Two uploads run at once, with increasing randomized retry delays, and an immediate retry when the connection returns or the page comes back to the front. An expired upload URL is renewed automatically.
- Each photo shows one true state: *Waiting*, *Uploading 40%*, *No signal, will retry*, *Added*, *Waiting for host*, or *Failed* with a reason. "Added" appears only after the server has the file.
- Two tabs never send the same queue.

**Known limits, told to the guest:**

- Phones pause uploads when the browser is closed or in the background. Text: "Keep this page open until your photos finish. If it closes, reopen it and we'll continue."
- If phone storage is too full to save the queue, uploads continue from memory with "Don't close this page".
- Clearing website data, or private browsing, removes the queue.

## 7. Live updates

Each change is announced after commit through Postgres `NOTIFY` with only the event ID, type and item IDs. Each web process listens once and fans out over server-sent events, filtered by what each viewer may see. The browser fetches the changed items in batches (at most once a second) through TanStack Query.

Announcements can be missed, so they are only hints: on every connect or reconnect the browser refetches what it is showing. If streaming fails, it polls every 15 seconds. Heart counts are combined every 2 seconds. A freeze, setting change or changed PIN takes effect on open screens immediately.

While someone is scrolled down, new photos don't shift the page; a "12 new photos" button appears.

## 8. Organizing and social

- **Albums:** a photo is in one album or none. Deleting an album keeps its photos.
- **Hashtags:** up to 10 per photo, 40 characters, letters (any language), digits and underscore, matched without case. Hosts can suggest tags, and can remove a tag, which takes it off all photos and blocks its reuse in that event.
- **Views:** All, each album, each hashtag, Most Hearted, Featured. **Trending** is tags with the most photos in the last 2 hours, then overall **[call]**.
- **Order:** newest upload (default), time taken, or featured first. The host sets the default; a guest can switch.
- **Hearts:** one per person per photo. **Comments:** plain text, 500 characters, beneath a photo.
- Switching hearts or comments off hides existing ones and blocks new ones. Nothing is deleted, and switching on restores them. Most Hearted disappears while hearts are off.

## 9. Screens

**Guest gallery** (phone first)

```
+---------------------------+
| [cover photo]             |
| Ana & Marco               |
| Welcome message           |
+---------------------------+
| All  Ceremony  Dance  #.. |
+--------+--------+---------+
| photo  | photo  | photo   |
| photo  | photo  | photo   |
+--------+--------+---------+
|     [ + Add photos ]      |
+---------------------------+
```

**Add photos** (bottom sheet): choose from library or take a photo, previews, album, tags, optional first name, then Upload. Progress collapses to a small bar so guests can browse.

**Photo:** full screen with swipe; heart, comments, name, album, tags, download, delete (if theirs).

**TV mode** at its own secret link, so the venue laptop needs no login:

```
+------------------------------------------+
|                                          |
|          [ one photo, full screen ]      |
|                                          |
| Ana - Dance Floor               [ QR ]   |
+------------------------------------------+
```

New photos jump the line, otherwise it cycles through live ones. The host sets seconds per photo, album, and whether to show names, QR and PIN (PIN off by default). It keeps the screen awake where supported, keeps showing loaded photos if the network drops, and the link can be replaced.

**Host:** dashboard of events; create event (name, date, time zone, cover, welcome, albums, suggested tags); then per event: Photos (with bulk approve, hide, delete, move, feature), Waiting, Albums & tags, Share, Settings, Export.

**Share:** copy link; QR as SVG and 2048 px PNG; print-ready PDF signs (table card A6 and 4x6 in, welcome sign A4 and Letter) and a 1920x1080 PNG for screens. Three styles, editable headline and subtext, accent color, optional PIN. The download must match the preview, and generated QR codes are tested by decoding them.

**Public:** home page, sign-up and sign-in, privacy and terms pages with placeholder text for you to have reviewed, and a report-abuse contact.

**Look [call]:** photos carry the color; a quiet neutral interface, with each event's cover and accent color giving it personality. WCAG AA contrast, keyboard use on host screens, and reduced motion respected. Light theme only, except TV and full-screen photo, which are dark.

**Name [call]:** placeholder "Event Photos", stored in one setting.

## 10. Export and deletion

- **Export:** one click starts a job, with live progress, then a download link valid for 7 days and an email. Photos are stored uncompressed (they already are compressed) and written straight to storage, so size isn't limited by server disk. Live photos are included; hidden and waiting ones are optional. Names: `Dance Floor/2026-06-12_184501_Ana_0001.jpg`, made safe for Windows and Mac.
- It exports what existed when clicked. A failed photo is listed in the archive's `_errors.txt` rather than failing the whole export. One export per event runs at a time.
- **Delete event:** guests lose access at once; undo for 7 days, then everything is purged. **Delete account** does the same for all the host's events. Nothing else expires on its own.

## 11. Data

Better Auth's tables, plus:

| Table | Holds |
|---|---|
| `events` | owner, code, TV token, name, date, time zone, cover, welcome, accent, settings, PIN hash and version, frozen time, limits, usage, deleted time |
| `participants` | event, guest token hash or host user, name, PIN version passed |
| `albums` | event, name, position |
| `photos` | event, participant, album, client ID, status, size, hash, type, dimensions, placeholder, storage keys, time taken, uploaded and published times, featured, heart count, deleted by |
| `hashtags`, `photo_hashtags` | normalized and display text, suggested, blocked |
| `photo_contributors` | photo, participant, time added |
| `hearts` | unique per photo and participant |
| `comments` | photo, participant, text, hidden, deleted |
| `exports` | event, status, progress, options, storage key, expiry |
| `rate_limits` | key, window, count |

Uniqueness: event code; `(event, client ID)`; and `(event, hash)` for photos that aren't failed, expired or deleted. Usage and heart counts change in the same transaction as the rows they count. Galleries page by cursor.

## 12. Errors and safety

- Errors return a stable code and a plain sentence. Nobody sees a stack trace.
- Failed processing retries 3 times, then shows to the uploader and the host.
- Corrupt or disguised files are refused from their bytes, not their names. Image decoding has pixel and time limits.
- Changes require a same-origin request. All guest text is shown as text, never HTML. A content security policy is set.
- Every permission is checked on the server with the event, so an ID from another event never works.
- Logs contain no PINs, tokens or signed URLs. `/health` covers web, database, storage and worker.

## 13. Testing

- **Unit:** every row of the permission table for guest, host, another event's guest, and a signed-in non-owner; lifecycle transitions; tags; limits.
- **Integration (real Postgres):** upload repeated at each step, duplicates arriving together, quota under concurrency, freeze grace, PIN limits, live filtering.
- **Imaging:** real HEIC, rotated, wide-gamut, huge, corrupt and disguised files; proof that originals are byte-identical and public versions hold no GPS.
- **Browser (Playwright, Chromium and WebKit):** guest and host journeys, offline mid-upload, reload mid-upload, two guests live, TV mode, and export opened and compared with what was uploaded.
- **Load:** 200 streams with 500 uploads an hour; a 10 GB export, including an interrupted and resumed download.
- **Storage:** disk driver always. Real R2, including its signed size check and browser upload rules, only once you supply credentials.
- **Needs you:** real iPhone and Android devices, since emulators don't reproduce backgrounding and the iOS picker. Phones need an HTTPS address for this, such as a staging deployment.

## 14. Build order

Each step ends in something usable and tested.

1. Project, database, storage interface, host login
2. Events, albums, tags, guest access and PIN
3. Upload, processing and gallery
4. Offline queue and live updates
5. Hearts, comments, moderation, approval and freeze
6. QR, signs and TV mode
7. Export, deletion and limits
8. Public pages, load test, deployment files (Dockerfile and setup guide)

Deployment itself needs your accounts (server, R2, email, domain, optional Google) and is not part of the build. The app is complete when it passes these tests locally and ships with a setup guide.

## 15. Left to the builder

Folder layout, component structure, exact wording, sign artwork, image quality settings, retry timings, and PDF and ZIP libraries.
