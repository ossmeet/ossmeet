/**
 * sync-assets.mjs
 *
 * Downloads whiteboard engine assets (fonts, icons, embed-icons, translations)
 * into apps/web/public/wb-assets/ and generates the asset URL override
 * constant in packages/whiteboard/src/generated/wb-asset-urls.ts.
 *
 * Reads asset lists dynamically from the installed whiteboard vendor packages
 * so version upgrades are handled automatically.
 *
 * Usage:
 *   node packages/whiteboard/scripts/sync-assets.mjs          # download missing + regenerate
 *   node packages/whiteboard/scripts/sync-assets.mjs --force  # re-download everything
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(import.meta.dirname, '../../..')
const PUBLIC_DIR = path.join(ROOT, 'apps', 'web', 'public', 'wb-assets')
const GENERATED_FILE = path.join(ROOT, 'packages', 'whiteboard', 'src', 'generated', 'wb-asset-urls.ts')
const FORCE = process.argv.includes('--force')
const WHITEBOARD_PACKAGE_JSON = path.join(ROOT, 'packages', 'whiteboard', 'package.json')

// ---------------------------------------------------------------------------
// 1. Read asset lists from the installed whiteboard vendor packages
// ---------------------------------------------------------------------------

if (!fs.existsSync(WHITEBOARD_PACKAGE_JSON)) {
  console.log('\nSkipping whiteboard asset sync: packages/whiteboard/package.json is missing.\n')
  process.exit(0)
}

const whiteboardPackageJson = JSON.parse(
  fs.readFileSync(WHITEBOARD_PACKAGE_JSON, 'utf8')
)
const WHITEBOARD_TLDRAW_VERSION = whiteboardPackageJson?.dependencies?.tldraw

if (typeof WHITEBOARD_TLDRAW_VERSION !== 'string' || WHITEBOARD_TLDRAW_VERSION.length === 0) {
  throw new Error('packages/whiteboard/package.json must declare dependencies.tldraw')
}

function resolvePnpmPackageDir(name, version) {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm')
  const encodedName = name.startsWith('@') ? name.replace('/', '+') : name
  const prefix = `${encodedName}@${version}`

  const candidates = fs.readdirSync(pnpmDir).filter((entry) => entry.startsWith(prefix))
  for (const entry of candidates) {
    const pkgDir = path.join(pnpmDir, entry, 'node_modules', name)
    if (fs.existsSync(path.join(pkgDir, 'package.json'))) {
      return pkgDir
    }
  }

  throw new Error(`Cannot find ${name}@${version} in pnpm store`)
}

const tldrawDir = resolvePnpmPackageDir('tldraw', WHITEBOARD_TLDRAW_VERSION)
const editorDir = resolvePnpmPackageDir('@tldraw/editor', WHITEBOARD_TLDRAW_VERSION)

const { LANGUAGES } = require(path.join(editorDir, 'dist-cjs', 'index.js'))

const iconTypesSrc = fs.readFileSync(path.join(tldrawDir, 'src', 'lib', 'ui', 'icon-types.ts'), 'utf8')
const iconNames = [...iconTypesSrc.matchAll(/\|\s+'([^']+)'/g)].map(m => m[1])

const embedDefsSrc = fs.readFileSync(path.join(tldrawDir, 'src', 'lib', 'defaultEmbedDefinitions.ts'), 'utf8')
const embedTypes = [...embedDefsSrc.matchAll(/type:\s+'([^']+)'/g)].map(m => m[1])

const CDN_BASE = `https://cdn.tldraw.com/${WHITEBOARD_TLDRAW_VERSION}`

// Font keys — must match vendor's expected font-family identifiers
const FONT_FILES = {
  tldraw_mono: 'IBMPlexMono-Medium.woff2',
  tldraw_mono_italic: 'IBMPlexMono-MediumItalic.woff2',
  tldraw_mono_bold: 'IBMPlexMono-Bold.woff2',
  tldraw_mono_italic_bold: 'IBMPlexMono-BoldItalic.woff2',
  tldraw_serif: 'IBMPlexSerif-Medium.woff2',
  tldraw_serif_italic: 'IBMPlexSerif-MediumItalic.woff2',
  tldraw_serif_bold: 'IBMPlexSerif-Bold.woff2',
  tldraw_serif_italic_bold: 'IBMPlexSerif-BoldItalic.woff2',
  tldraw_sans: 'IBMPlexSans-Medium.woff2',
  tldraw_sans_italic: 'IBMPlexSans-MediumItalic.woff2',
  tldraw_sans_bold: 'IBMPlexSans-Bold.woff2',
  tldraw_sans_italic_bold: 'IBMPlexSans-BoldItalic.woff2',
  tldraw_draw: 'Shantell_Sans-Informal_Regular.woff2',
  tldraw_draw_italic: 'Shantell_Sans-Informal_Regular_Italic.woff2',
  tldraw_draw_bold: 'Shantell_Sans-Informal_Bold.woff2',
  tldraw_draw_italic_bold: 'Shantell_Sans-Informal_Bold_Italic.woff2',
}

const locales = LANGUAGES.map(l => l.locale)

// ---------------------------------------------------------------------------
// 2. Download helpers
// ---------------------------------------------------------------------------

async function download(url, dest) {
  if (!FORCE && fs.existsSync(dest)) return false
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const res = await fetch(url)
  if (!res.ok) {
    console.warn(`  Warning: Failed to download ${url} (${res.status})`)
    return false
  }
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest))
  return true
}

// ---------------------------------------------------------------------------
// 3. Download all assets
// ---------------------------------------------------------------------------

async function downloadAll() {
  let downloaded = 0
  let skipped = 0

  const track = (result) => { result ? downloaded++ : skipped++ }

  // Fonts
  console.log('Syncing fonts...')
  for (const [, file] of Object.entries(FONT_FILES)) {
    track(await download(`${CDN_BASE}/fonts/${file}`, path.join(PUBLIC_DIR, 'fonts', file)))
  }

  // Icon sprite
  console.log('Syncing icon sprite...')
  track(await download(
    `${CDN_BASE}/icons/icon/0_merged.svg`,
    path.join(PUBLIC_DIR, 'icons', 'icon', '0_merged.svg')
  ))

  // Embed icons
  console.log('Syncing embed icons...')
  for (const type of embedTypes) {
    track(await download(
      `${CDN_BASE}/embed-icons/${type}.png`,
      path.join(PUBLIC_DIR, 'embed-icons', `${type}.png`)
    ))
  }

  // Translations
  console.log('Syncing translations...')
  for (const locale of locales) {
    track(await download(
      `${CDN_BASE}/translations/${locale}.json`,
      path.join(PUBLIC_DIR, 'translations', `${locale}.json`)
    ))
  }

  console.log(`  Done: ${downloaded} downloaded, ${skipped} already up-to-date`)
}

// ---------------------------------------------------------------------------
// 4. Generate wb-asset-urls.ts
// ---------------------------------------------------------------------------

function generateAssetUrlsFile() {
  const fontEntries = Object.entries(FONT_FILES)
    .map(([key, file]) => `    ${key}: '/wb-assets/fonts/${file}',`)
    .join('\n')

  const iconEntries = iconNames.map(name => `'${name}'`)
  const embedEntries = embedTypes.map(type => `'${type}'`)
  const translationEntries = locales.map(locale => `'${locale}'`)

  const code = `/**
 * Self-hosted whiteboard asset URLs.
 *
 * AUTO-GENERATED by packages/whiteboard/scripts/sync-assets.mjs — do not edit manually.
 * Re-run: node packages/whiteboard/scripts/sync-assets.mjs
 *
 * Whiteboard engine assets — version ${CDN_BASE.split('/').pop()}
 */

export const WB_ASSET_URLS = {
  fonts: {
${fontEntries}
  },
  icons: Object.fromEntries(
    [
      ${wrapArray(iconEntries, 6)},
    ].map(name => [name, \`/wb-assets/icons/icon/0_merged.svg#\${name}\`])
  ),
  embedIcons: Object.fromEntries(
    [
      ${wrapArray(embedEntries, 6)},
    ].map(type => [type, \`/wb-assets/embed-icons/\${type}.png\`])
  ),
  translations: Object.fromEntries(
    [
      ${wrapArray(translationEntries, 8)},
    ].map(locale => [locale, \`/wb-assets/translations/\${locale}.json\`])
  ),
}
`

  fs.mkdirSync(path.dirname(GENERATED_FILE), { recursive: true })
  fs.writeFileSync(GENERATED_FILE, code, 'utf-8')
  console.log(`  Generated ${path.relative(ROOT, GENERATED_FILE)}`)
}

/** Wrap an array of quoted strings into lines of at most `perLine` items */
function wrapArray(items, perLine) {
  const lines = []
  for (let i = 0; i < items.length; i += perLine) {
    lines.push(items.slice(i, i + perLine).join(','))
  }
  return lines.join(',\n      ')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`\nSyncing whiteboard assets from ${CDN_BASE}\n`)
await downloadAll()
generateAssetUrlsFile()
console.log('\nDone!\n')
process.exit(0)
