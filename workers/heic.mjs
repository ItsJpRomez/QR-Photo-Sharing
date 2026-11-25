// Decodes one HEIC photo, away from the main thread so a bad file can be abandoned.
import { parentPort, workerData } from 'node:worker_threads'
import libheif from 'libheif-js/wasm-bundle.js'

const images = new libheif.HeifDecoder().decode(workerData)
if (!images.length) throw new Error('No image in this file')
const image = images[0]
const width = image.get_width()
const height = image.get_height()
const data = new Uint8ClampedArray(width * height * 4)
image.display({ data, width, height }, (done) => {
  if (!done) throw new Error('This file could not be decoded')
  parentPort.postMessage({ width, height, data }, [data.buffer])
})
