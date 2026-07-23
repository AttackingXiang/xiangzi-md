import console from 'node:console'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

const DIST_DIR = resolve('dist')
const ENTRY_GZIP_LIMIT = Number(process.env.BUNDLE_ENTRY_GZIP_LIMIT ?? 210 * 1024)
const CHUNK_GZIP_LIMIT = Number(process.env.BUNDLE_CHUNK_GZIP_LIMIT ?? 210 * 1024)
const TOTAL_LIMIT = Number(process.env.BUNDLE_TOTAL_LIMIT ?? 12 * 1024 * 1024)

function filesBelow(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  })
}

function kib(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

if (!existsSync(join(DIST_DIR, 'index.html'))) {
  throw new Error('dist/index.html is missing; run the production build before bundle:check')
}

const files = filesBelow(DIST_DIR)
const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0)
const javascript = files
  .filter((file) => file.endsWith('.js'))
  .map((file) => ({ file, gzipBytes: gzipSync(readFileSync(file)).byteLength }))
  .sort((left, right) => right.gzipBytes - left.gzipBytes)

const html = readFileSync(join(DIST_DIR, 'index.html'), 'utf8')
const entrySource = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1]
if (!entrySource) throw new Error('Unable to locate the production entry script in dist/index.html')
const entryPath = join(DIST_DIR, entrySource.replace(/^\//, ''))
const entry = javascript.find(({ file }) => file === entryPath)
if (!entry) throw new Error(`Entry script is missing from the build output: ${entryPath}`)

const largest = javascript[0]
const failures = []
if (entry.gzipBytes > ENTRY_GZIP_LIMIT) {
  failures.push(`entry gzip ${kib(entry.gzipBytes)} exceeds ${kib(ENTRY_GZIP_LIMIT)}`)
}
if (largest && largest.gzipBytes > CHUNK_GZIP_LIMIT) {
  failures.push(
    `largest JS gzip ${kib(largest.gzipBytes)} exceeds ${kib(CHUNK_GZIP_LIMIT)} (${largest.file})`,
  )
}
if (totalBytes > TOTAL_LIMIT) {
  failures.push(`dist total ${kib(totalBytes)} exceeds ${kib(TOTAL_LIMIT)}`)
}

console.log(
  `Bundle budget: entry=${kib(entry.gzipBytes)}, largest-js=${kib(largest?.gzipBytes ?? 0)}, total=${kib(totalBytes)}`,
)
if (failures.length > 0) throw new Error(`Bundle budget exceeded:\n- ${failures.join('\n- ')}`)
