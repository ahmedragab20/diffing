import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** Write JSON via a temp file and rename so readers never see a partial file. */
export function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf-8')
  renameSync(temporary, path)
}
