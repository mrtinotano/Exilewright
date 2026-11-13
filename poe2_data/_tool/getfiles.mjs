// Usage: node getfiles.mjs <gameDir> <outDir> <path|@listfile> [...]   (pulls single files out of the bundles, e.g. .ot)
import { FileLoader } from 'pathofexile-dat/bundles.js'
import { SteamBundleLoader, CachingBundleLoader } from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js'
import * as fs from 'fs/promises'
import * as path from 'path'

const [gameDir, outDir, ...args] = process.argv.slice(2)
const paths = []
for (const a of args) {
  if (a.startsWith('@')) paths.push(...(await fs.readFile(a.slice(1), 'utf8')).split('\n').map(l => l.trim()).filter(Boolean))
  else paths.push(a)
}
const loader = await FileLoader.create(new CachingBundleLoader(new SteamBundleLoader(gameDir)))
for (const p of paths) {
  const bin = await loader.tryGetFileContents(p)
  if (!bin) { console.log('missing', p); continue }
  const out = path.join(outDir, 'files', p.toLowerCase())
  await fs.mkdir(path.dirname(out), { recursive: true })
  await fs.writeFile(out, bin)
  console.log('ok', p, bin.length)
}
