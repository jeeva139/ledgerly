// Downloads the Electron binary into node_modules/electron/dist.
// Electron's own install.js needs Node >= 22.12 (require(esm)); this script does the same
// work with a dynamic import so the project can also be set up with Node 20.
// Development-time step only. The shipped application never touches the network.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = path.join(root, 'node_modules', 'electron')
const distDir = path.join(electronDir, 'dist')
const pathTxt = path.join(electronDir, 'path.txt')

if (!fs.existsSync(path.join(electronDir, 'package.json'))) {
  console.log('electron package not installed yet; skipping binary setup.')
  process.exit(0)
}
const { version } = JSON.parse(fs.readFileSync(path.join(electronDir, 'package.json'), 'utf8'))

const installedVersion = () => {
  try {
    return fs.readFileSync(path.join(distDir, 'version'), 'utf8').trim().replace(/^v/, '')
  } catch {
    return ''
  }
}
if (fs.existsSync(pathTxt) && fs.existsSync(path.join(distDir, 'electron.exe')) && installedVersion() === version) {
  console.log(`Electron ${version} already installed.`)
  process.exit(0)
}

// @electron/get is ESM-only (no "require" export condition), so locate it by path.
const findPkg = (name) => {
  for (const base of [path.join(electronDir, 'node_modules'), path.join(root, 'node_modules')]) {
    const p = path.join(base, name)
    if (fs.existsSync(path.join(p, 'package.json'))) return p
  }
  throw new Error(`Cannot find ${name}`)
}
const getDir = findPkg('@electron/get')
const getPkg = JSON.parse(fs.readFileSync(path.join(getDir, 'package.json'), 'utf8'))
const exp = getPkg.exports
const getMain =
  typeof exp === 'string' ? exp : (exp?.['.']?.import ?? exp?.['.']?.default ?? exp?.['.'] ?? getPkg.main ?? 'dist/index.js')
const { downloadArtifact } = await import(pathToFileURL(path.join(getDir, String(getMain))).href)

let checksums
try {
  checksums = JSON.parse(fs.readFileSync(path.join(electronDir, 'checksums.json'), 'utf8'))
} catch {
  /* optional */
}

console.log(`Downloading Electron ${version} (win32-x64)...`)
const zipPath = await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch: 'x64', checksums })

fs.rmSync(distDir, { recursive: true, force: true })
fs.mkdirSync(distDir, { recursive: true })
// Windows 10+ ships bsdtar (System32	ar.exe), which extracts zip archives. Use it by absolute
// path so a GNU tar earlier on PATH (e.g. from Git Bash) cannot misread "C:" as a remote host.
const tarExe = path.join(process.env.SystemRoot ?? 'C:\Windows', 'System32', 'tar.exe')
const res = spawnSync(fs.existsSync(tarExe) ? tarExe : 'tar', ['-xf', zipPath, '-C', distDir], { stdio: 'inherit' })
if (res.status !== 0) throw new Error('Could not extract the Electron archive (tar failed).')
fs.writeFileSync(pathTxt, 'electron.exe')
console.log('Electron installed at', distDir)
