import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const base = new URL('./node_modules/@typespec/http-server-csharp/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('package.json', base), 'utf8'))
if (manifest.version !== '0.58.0-alpha.32')
  throw new Error('Emitter patch only supports 0.58.0-alpha.32')

// Exactly the three source corrections validated in #56; never rewrite generated C#.
const patches = [
  {
    path: 'dist/src/components/models/models.js',
    hash: '3e95c1ea1cab54fe251211d85d77cc87b89525a23a8cb06d2e8621c45b6b8c17',
    changes: [
      [
        'const needsNullable = props.type.optional && (isFloatEnum || isValueType($, resolvedType));',
        'const needsNullable = props.type.optional;',
      ],
      [
        'nullable: needsNullable,',
        'nullable: needsNullable,\n    required: !props.type.optional && initializer === undefined && !isErrorProp,',
      ],
    ],
  },
  {
    path: 'dist/src/components/type-expression/type-expression.js',
    hash: 'd451ef3ab74d499116239cb1158e90cbe3541c9e2a5119d6592674b7dcc4719b',
    changes: [['[$.builtin.plainDate, "DateTime"]', '[$.builtin.plainDate, "DateOnly"]']],
  },
]
// Validate every complete source before writing any file. Reverse our exact patch
// to recognize both the pristine and already-patched package, rejecting other edits.
const outputs = patches.map(({ path, hash, changes }) => {
  const file = new URL(path, base)
  let original = readFileSync(file, 'utf8')
  for (const [before, after] of changes) original = original.replace(after, before)
  if (createHash('sha256').update(original).digest('hex') !== hash) {
    throw new Error(
      `Unexpected emitter source: ${path}; refusing patch. Restore with npm ci --prefix contract/server`,
    )
  }
  let patched = original
  for (const [before, after] of changes) patched = patched.replace(before, after)
  return [file, patched]
})
for (const [file, source] of outputs) writeFileSync(file, source)
console.log('Verified alpha.32 project patch: required, nullable, DateOnly')
