// Decodes one HEIC photo, away from the main thread so a bad file can be abandoned.
// Answers { bad: true } only when the file itself is at fault; anything else is thrown.
import { parentPort, workerData } from 'node:worker_threads'
import libheif from 'libheif-js/wasm-bundle.js'

const isOurs = (err) => err instanceof RangeError || /abort|memory|OOM/i.test(String(err?.message ?? err))

function decode() {
  const images = new libheif.HeifDecoder().decode(workerData)
  if (!images.length) return parentPort.postMessage({ bad: true })
  const image = images[0]
  const width = image.get_width()
  const height = image.get_height()
  const data = new Uint8ClampedArray(width * height * 4)
  image.display({ data, width, height }, (done) => {
    if (done) parentPort.postMessage({ width, height, data }, [data.buffer])
    else parentPort.postMessage({ bad: true })
  })
}

try {
  decode()
} catch (err) {
  if (isOurs(err)) throw err
  parentPort.postMessage({ bad: true })
}
