# Putting it online

You need a server that stays on, Postgres, Cloudflare R2, an email service and a domain. Nothing here is set up for you, because each needs your own account.

## 1. What runs

| Process | Command | How many |
|---|---|---|
| web | `npm start` | 1 to start with |
| worker | `npm run start:worker` | 1 |
| migrations | `npm run db:migrate` | once per release, before starting |

Both use the same code, the same settings and the same database. Start in the project folder, because HEIC decoding and sign fonts are read from there. A 2 GB, 2-core server is a sensible start: the worker decodes large photos, two at a time.

On Railway or Fly, make two services from the `Dockerfile` and set the command for each. On a VPS, run both with systemd or Docker Compose behind Caddy or nginx.

**Not tested:** the Dockerfile has not been built, because Docker wasn't available where this was made. Build it once before relying on it.

## 2. Settings

Copy `.env.example`. In production you need:

| Setting | Notes |
|---|---|
| `APP_URL` | Your public address, with `https://`. QR codes contain it, so decide it before printing. |
| `APP_SECRET` | `openssl rand -base64 32`. Changing it later invalidates every PIN. Keep a copy. |
| `DATABASE_URL` | A **direct** connection. Live updates use `LISTEN`, which doesn't work through a transaction pooler such as PgBouncer. |
| `STORAGE_DRIVER=s3` and `S3_*` | See below. Disk storage refuses to start in production. |
| `SMTP_URL`, `MAIL_FROM` | Hosts can't verify their address without email. |
| `TRUSTED_PROXY_HOPS` | How many proxies add to `X-Forwarded-For`. Usually `1`; `2` behind Cloudflare and another proxy. Too low makes every guest share one PIN limit; too high lets someone fake their address. |
| `REPORT_EMAIL` | Shown on the report page. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional. Redirect address: `APP_URL/api/auth/callback/google`. |

## 3. Cloudflare R2

1. Create a bucket. Leave public access **off**.
2. Create an API token with Object Read & Write for that bucket only.
3. `S3_ENDPOINT` is `https://<account>.r2.cloudflarestorage.com`, `S3_REGION` is `auto`.
4. Add this CORS rule, with your own address:

```json
[
  {
    "AllowedOrigins": ["https://photos.example.com"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["content-type"],
    "ExposeHeaders": ["etag"],
    "MaxAgeSeconds": 3600
  }
]
```

5. Check it against the real bucket before launch. This includes the signed upload size, which could not be checked without an account:

```bash
S3_TEST_ENDPOINT=... S3_TEST_BUCKET=... S3_TEST_ACCESS_KEY_ID=... S3_TEST_SECRET_ACCESS_KEY=... npx vitest run tests/integration/storage-s3.test.ts
```

If a file one byte too long is accepted, the app still refuses it when the upload is completed; the bucket would just hold it until cleanup.

## 4. The proxy in front

- HTTPS is required: phones block uploads, cameras and storage on plain HTTP.
- Use HTTP/2. Every open gallery holds one connection for live updates.
- Keep idle connections open for less than 75 seconds on the proxy side, which is how long the app keeps them. Otherwise some requests fail at random.
- Don't buffer `/api/e/*/stream` and `/api/tv/*/stream`. The app sends `X-Accel-Buffering: no`, which nginx respects. If your host closes long connections, galleries reconnect by themselves.

## 5. Keep an eye on it

- `GET /health` gives 200, or 503 naming `database`, `storage` or `worker`.
- Back up Postgres daily. Photos live in R2; turn on object versioning or copy the bucket if you want protection from accidental deletion.
- Logs never contain PINs, tokens or signed links.

## 6. Before the first real event

- [ ] Have the privacy and terms pages reviewed. They are placeholders.
- [ ] Choose a name and set `APP_NAME`.
- [ ] Print one sign and scan it from a table's distance.
- [ ] Follow the phone checklist below on at least one iPhone and one Android.

### Phone checklist

Emulators don't reproduce these, so they need real phones on the real address:

- [ ] Scan the QR code with the built-in camera app.
- [ ] Open the link from Messenger, Instagram and WhatsApp, which use their own browsers.
- [ ] Choose 30 photos from the library, including HEIC and a Live Photo. Check the host's download is HEIC.
- [ ] Take a photo with the in-page camera button.
- [ ] Turn on airplane mode half way through, wait a minute, turn it off.
- [ ] Switch to another app half way, wait two minutes, come back.
- [ ] Close the browser half way, open the link again.
- [ ] Lock the phone half way, unlock it.
- [ ] Try it in private browsing.
- [ ] Save a photo from the gallery and find it in the phone's photos.
- [ ] Leave TV mode running for an hour on the venue's laptop.
