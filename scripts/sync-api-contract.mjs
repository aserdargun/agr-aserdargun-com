#!/usr/bin/env node
/**
 * Copy the archive contract into the Functions app.
 *
 * There is one archive contract, `scripts/archive-contract.mjs`, and three consumers: the
 * browser bundle, the Node filing tool and the Azure archive endpoint. Oryx only packages
 * the `api/` directory, so the endpoint cannot reach the original by a relative path and
 * the file is copied rather than referenced. The copy is generated, never committed, and
 * `tests/archive-contract.test.ts` checks it is byte-identical, so the endpoint cannot
 * quietly drift onto a second version of the rule.
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const SOURCE = join('scripts', 'archive-contract.mjs')
const TARGET = join('api', 'lib', 'archive-contract.mjs')

const sameBytes = async () => {
  try {
    const [source, target] = await Promise.all([readFile(SOURCE), readFile(TARGET)])
    return source.equals(target)
  } catch {
    return false
  }
}

if (await sameBytes()) {
  console.log('api contract: already in step')
} else {
  await mkdir(dirname(TARGET), { recursive: true })
  await copyFile(SOURCE, TARGET)
  console.log(`api contract: ${SOURCE} -> ${TARGET}`)
}
