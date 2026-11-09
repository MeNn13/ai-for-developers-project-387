// Fails on mojibake: UTF-8 text that was decoded as a single-byte encoding
// (CP1251/CP1252) and saved again. Marker characters are built from code
// points, so this file contains no literal marker and cannot match itself.
//
// Two signatures are detected:
// 1. Cyrillic UTF-8 read as Windows-1251: two-byte sequences D0 xx / D1 xx
//    become Р/С followed by a CP1251 high-range glyph (Ukrainian letters,
//    typographic quotes, dashes, №...). Russian text never has Р or С directly
//    followed by one of those characters.
// 2. UTF-8 read as CP1252/Latin-1: lead bytes become Latin-1 capital letters
//    with strokes, tildes or circumflexes, which never occur in this codebase.
//    The replacement character U+FFFD is flagged too: it means data was
//    already lost.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SCAN_EXTENSIONS = new Set([
  '.cs',
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.yaml',
  '.yml',
  '.tsp',
  '.toml',
  '.pkl',
  '.css',
  '.html',
])

const cp = (...codes) => String.fromCodePoint(...codes)
const hex = (code) => `\\u{${code.toString(16)}}`

// CP1251 maps bytes 0x80–0xBF to these glyphs; they are the second character
// of a misread Cyrillic two-byte sequence.
const cp1251High = [
  0x0402, 0x0403, 0x201a, 0x0453, 0x201e, 0x2026, 0x2020, 0x2021, 0x20ac, 0x2030, 0x0409, 0x2039,
  0x040a, 0x040c, 0x040b, 0x040f, 0x0452, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x2122, 0x0459, 0x203a, 0x045c, 0x045d, 0x045b, 0x045f, 0x00a0, 0x040e, 0x045e, 0x0408, 0x00a4,
  0x0490, 0x00a6, 0x00a7, 0x0401, 0x00a9, 0x0404, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x0407, 0x00b0,
  0x00b1, 0x0406, 0x0456, 0x0491, 0x00b5, 0x00b6, 0x00b7, 0x0451, 0x2116, 0x0454, 0x00bb, 0x0458,
  0x0405, 0x0455, 0x0457,
]

const cyrillicPair = new RegExp(
  `[${cp(0x0420)}${cp(0x0421)}][${cp1251High.map(hex).join('')}]`,
  'u',
)
const latin1Lead = new RegExp(
  `[${[0x00d0, 0x00d1, 0x00c2, 0x00c3, 0xfffd].map(hex).join('')}]`,
  'u',
)

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  },
)
  .split('\0')
  .filter((file) => SCAN_EXTENSIONS.values().some((ext) => file.endsWith(ext)))

let hits = 0
let scanned = 0

for (const file of files) {
  let content
  try {
    content = readFileSync(file, 'utf8')
  } catch (error) {
    // Git still lists working-tree deletions until they are staged.
    if (error.code === 'ENOENT') continue
    throw error
  }
  scanned += 1
  const lines = content.split('\n')

  lines.forEach((line, index) => {
    if (cyrillicPair.test(line) || latin1Lead.test(line)) {
      hits += 1
      const preview = line.trim().slice(0, 80)
      console.error(`${file}:${index + 1}: possible mojibake: ${preview}`)
    }
  })
}

if (hits > 0) {
  console.error(
    `\nencoding-check: ${hits} suspicious line(s) — текст похож на дважды перекодированный UTF-8`,
  )
  process.exit(1)
}

console.log(`encoding-check: clean (${scanned} files scanned)`)
