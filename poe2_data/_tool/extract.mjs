// Usage: node extract.mjs <gameDir> <outDir>
import { FileLoader, decompressSliceInBundle, decompressedBundleSize, readIndexBundle } from 'pathofexile-dat/bundles.js'
import { readDatFile } from './node_modules/pathofexile-dat/dist/dat/dat-file.js'
import { readColumn } from './node_modules/pathofexile-dat/dist/dat/reader.js'
import { getHeaderLength } from './node_modules/pathofexile-dat/dist/dat/header.js'
import { SCHEMA_URL, SCHEMA_VERSION, ValidFor } from 'pathofexile-dat-schema'
import { unpackPaths } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js'
import { SteamBundleLoader, CachingBundleLoader } from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js'
import * as fs from 'fs/promises'
import * as path from 'path'

const [gameDir, outDir] = process.argv.slice(2)
// every game language (folder names under Data/Balance); available.py turns them into name_<code> fields
const LANGS = Object.fromEntries([['English', 'Data/Balance'], ...['Spanish', 'Portuguese', 'French', 'German', 'Russian', 'Japanese', 'Korean', 'Thai', 'Traditional Chinese'].map(l => [l, 'Data/Balance/' + l])])
const TEXT_PREFIXES = ['data/statdescriptions/', 'metadata/']
const TEXT_EXT = /(statdescriptions\/.*\.csd|\.psg)$/i

const bundles = new CachingBundleLoader(new SteamBundleLoader(gameDir))
const loader = await FileLoader.create(bundles)

// full file list from the index
const indexBin = await bundles.fetchFile('_.index.bin')
const idx = new Uint8Array(decompressedBundleSize(indexBin))
decompressSliceInBundle(indexBin, 0, idx)
const { pathRepsBundle } = readIndexBundle(idx)
const reps = new Uint8Array(decompressedBundleSize(pathRepsBundle))
decompressSliceInBundle(pathRepsBundle, 0, reps)
const { dirsInfo } = readIndexBundle(idx)
// note: dirsInfo entries are (hash u64, offset u32, size u32, recursive u32) = 20 bytes
const allPaths = []
const dv = new DataView(dirsInfo.buffer, dirsInfo.byteOffset, dirsInfo.byteLength)
for (let i = 0; i < dirsInfo.byteLength; i += 20) {
  const off = dv.getUint32(i + 8, true), size = dv.getUint32(i + 12, true)
  for (const p of unpackPaths(reps.subarray(off, off + size))) allPaths.push(p)
}
await fs.mkdir(outDir, { recursive: true })
if (!process.env.SKIP_TABLES) await fs.writeFile(path.join(outDir, 'all_files.txt'), allPaths.sort().join('\n'))
console.log(`index: ${allPaths.length} files`)

// tables
const schema = await (await fetch(SCHEMA_URL)).json()
if (schema.version !== SCHEMA_VERSION) throw new Error('schema version mismatch, update pathofexile-dat')
const tables = schema.tables.filter(t => t.validFor & ValidFor.PoE2)
await fs.writeFile(path.join(outDir, 'schema.json'), JSON.stringify({ tables, enumerations: schema.enumerations.filter(e => e.validFor & ValidFor.PoE2) }, null, 1))

function headersFor(sch, dat) {
  const headers = []
  let offset = 0
  for (const c of sch.columns) {
    const t = c.type
    const h = {
      name: c.name || '', offset,
      type: {
        array: c.array, interval: c.interval,
        integer: t === 'u16' ? { unsigned: true, size: 2 } : t === 'u32' ? { unsigned: true, size: 4 }
          : t === 'i16' ? { unsigned: false, size: 2 } : (t === 'i32' || t === 'enumrow') ? { unsigned: false, size: 4 } : undefined,
        decimal: t === 'f32' ? { size: 4 } : undefined,
        string: t === 'string' ? {} : undefined,
        boolean: t === 'bool' ? {} : undefined,
        key: (t === 'row' || t === 'foreignrow') ? { foreign: t === 'foreignrow' } : undefined,
      },
    }
    headers.push(h)
    offset += getHeaderLength(h, dat)
  }
  return headers
}

const failed = []
for (const [lang, dir] of process.env.SKIP_TABLES ? [] : Object.entries(LANGS)) {
  await fs.mkdir(path.join(outDir, 'tables', lang), { recursive: true })
  let n = 0
  for (const sch of tables) {
    try {
      const bin = await loader.tryGetFileContents(`${dir}/${sch.name.toLowerCase()}.datc64`)
      if (!bin) continue
      const dat = readDatFile('.datc64', bin)
      const headers = headersFor(sch, dat).filter(h => h.name && h.offset + 0 <= dat.rowLength)
      const cols = []
      for (const h of headers) {
        try { cols.push({ name: h.name, data: readColumn(h, dat) }) } catch { break } // schema longer than file: stop at first bad column
      }
      const rows = Array.from({ length: dat.rowCount }, (_, i) => Object.fromEntries([['_index', i], ...cols.map(c => [c.name, c.data[i]])]))
      await fs.writeFile(path.join(outDir, 'tables', lang, `${sch.name}.json`), JSON.stringify(rows))
      n++
    } catch (e) { if (lang === 'English') failed.push(`${sch.name}: ${e.message}`) }
  }
  bundles.clearBundleCache()
  console.log(`${lang}: ${n} tables`)
}
await fs.writeFile(path.join(outDir, 'failed_tables.txt'), failed.join('\n'))

// raw text/data files useful for builds (stat descriptions, passive tree, etc.)
let nf = 0
for (const p of allPaths) {
  if (!TEXT_PREFIXES.some(pre => p.startsWith(pre)) || !TEXT_EXT.test(p)) continue
  const bin = await loader.tryGetFileContents(p)
  if (!bin) continue
  const dst = path.join(outDir, 'files', p)
  await fs.mkdir(path.dirname(dst), { recursive: true })
  // GGG text files are UTF-16LE with BOM; convert to UTF-8
  const isU16 = bin[0] === 0xff && bin[1] === 0xfe
  await fs.writeFile(dst, isU16 ? Buffer.from(bin.subarray(2)).toString('utf16le') : bin)
  nf++
}
console.log(`files: ${nf}, failed tables: ${failed.length}`)
