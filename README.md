# Live QR event photo sharing

Hosts put out one QR code. Guests scan it and add original-quality photos from the browser, with no app and no account. The gallery fills live, and afterwards the host downloads everything in one ZIP.

- Design: [docs/superpowers/specs](docs/superpowers/specs/2026-11-25-qr-event-photo-sharing-design.md)
- Putting it online: [docs/setup.md](docs/setup.md)

## Run it here

Needs Node 22.12 or newer and Postgres.

```bash
createdb event_photos_dev
```

```bash
cp .env.example .env
```

```bash
npm install
```

```bash
npm run db:migrate
```

Then in two terminals:

```bash
npm run dev
```

```bash
npm run dev:worker
```

Open http://localhost:3000. Emails, such as the link that confirms a host's address, print in the first terminal. Photos are kept in `.data/storage`.

## Tests

| What | Command |
|---|---|
| Types, lint, unit and integration | `npm run check` (needs `createdb event_photos_test`) |
| Browser, Chromium and WebKit | `npm run test:e2e` (needs `createdb event_photos_e2e` and `npx playwright install chromium webkit`) |
| Load | `scripts/load.ts`, `scripts/big-export.ts` |

HEIC fixtures were made on a Mac with `tests/fixtures/make.ts` and are committed, so tests run anywhere.

## Measured

On 2026-11-25, on one Mac running everything (web, worker, Postgres, local storage and the load itself). A real server and network will differ.

| What | Result | Target |
|---|---|---|
| 200 guests watching, 500 uploads an hour, 10 minutes: time from upload confirmed to visible on another screen | 1.9 s median, **2.2 s** at 95%, 2.7 s at most. All 16,600 deliveries arrived. A 3-minute rerun after the review fixes: 1.9 s median, 2.4 s at 95%, all 5,000 arrived | 5 s at 95% |
| Memory during that run | web 90-247 MB, worker 126-395 MB, not growing | steady |
| Gallery on simulated Fast 4G and a slow phone (Lighthouse) | content visible in 0.8 s, largest in 0.9 s. Test thumbnails were small, so real photos take somewhat longer | 2.5 s |
| 10 GB export | 16 s, at most 382 MB of memory. Download cut at 40% and resumed was identical, and every file checked out | completes and resumes |

## How it fits together

`web` (Next.js) serves pages, the API and live streams. `worker` processes photos, builds ZIPs and cleans up. Postgres holds all state, the job queue and change notifications. Browsers send photos straight to storage through signed links.

Permissions are decided in one place, `src/modules/access/can.ts`, and which photos a person may see in `visibleTo` in `src/modules/photos/query.ts`.
