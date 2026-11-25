import type { JobWithMetadata } from 'pg-boss'
import { db, getPool } from '@/db/client'
import { heartbeats } from '@/db/schema'
import { getBoss, type Jobs } from './boss'
import { runCleanup } from './cleanup'
import { handleCoverJob, handleDownloadJob, handleExportJob, handleProcessJob, handlePurgeJob } from './handlers'

const boss = await getBoss()

await boss.work(
  'photo.process',
  { batchSize: 1, localConcurrency: 2, pollingIntervalSeconds: 0.5, includeMetadata: true },
  async ([job]: JobWithMetadata<Jobs['photo.process']>[]) => {
    if (job) await handleProcessJob(job.data, job)
  },
)
await boss.work<Jobs['photo.purge']>('photo.purge', { batchSize: 1, localConcurrency: 2 }, async ([job]) => {
  if (job) await handlePurgeJob(job.data)
})

await boss.work(
  'photo.download',
  { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 0.5, includeMetadata: true },
  async ([job]: JobWithMetadata<Jobs['photo.download']>[]) => {
    if (job) await handleDownloadJob(job.data, job)
  },
)
await boss.work<Jobs['cover.process']>('cover.process', { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 0.5 }, async ([job]) => {
  return job ? await handleCoverJob(job.data) : undefined
})
await boss.work(
  'export.build',
  { batchSize: 1, localConcurrency: 1, includeMetadata: true },
  async ([job]: JobWithMetadata<Jobs['export.build']>[]) => {
    if (job) await handleExportJob(job.data, job)
  },
)

await boss.createQueue('cleanup', { retryLimit: 0, policy: 'short' })
await boss.work('cleanup', { batchSize: 1 }, () => runCleanup(new Date()))
await boss.schedule('cleanup', '*/15 * * * *')

async function beat() {
  const at = new Date()
  await db
    .insert(heartbeats)
    .values({ name: 'worker', at })
    .onConflictDoUpdate({ target: heartbeats.name, set: { at } })
    .catch((err: Error) => console.error('Heartbeat failed', err.message))
}
await beat()
const timer = setInterval(() => void beat(), 15_000)

let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  clearInterval(timer)
  await boss.stop({ graceful: true, timeout: 25_000 })
  await getPool().end()
  process.exit(0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
console.log('Worker is running.')
