import { readFileSync, writeFileSync } from 'node:fs'

const manifest = JSON.parse(
  readFileSync(
    new URL('./node_modules/@typespec/http-server-csharp/package.json', import.meta.url),
    'utf8',
  ),
)
if (manifest.version !== '0.58.0-alpha.32') throw new Error('Patch only supports alpha.32')

// Experimental generator correction, never a rewrite of emitted C#.
const file = new URL(
  './node_modules/@typespec/http-server-csharp/dist/src/components/models/models.js',
  import.meta.url,
)
let source = readFileSync(file, 'utf8')
const changes = [
  [
    'const needsNullable = props.type.optional && (isFloatEnum || isValueType($, resolvedType));',
    'const needsNullable = props.type.optional;',
  ],
  [
    'nullable: needsNullable,',
    'nullable: needsNullable,\n    required: !props.type.optional && initializer === undefined && !isErrorProp,',
  ],
]
for (const [before, after] of changes) {
  if (source.includes(after)) continue
  if (source.split(before).length !== 2)
    throw new Error('Unexpected emitter source; refusing patch')
  source = source.replace(before, after)
}
writeFileSync(file, source)
console.log('Applied experimental required/optional correction to alpha.32 emitter')

const typesFile = new URL(
  './node_modules/@typespec/http-server-csharp/dist/src/components/type-expression/type-expression.js',
  import.meta.url,
)
const types = readFileSync(typesFile, 'utf8')
const before = '[$.builtin.plainDate, "DateTime"]'
const after = '[$.builtin.plainDate, "DateOnly"]'
if (!types.includes(after) && types.split(before).length !== 2)
  throw new Error('Unexpected plainDate mapping; refusing patch')
writeFileSync(typesFile, types.replace(before, after))
console.log('Applied experimental plainDate mapping correction')
