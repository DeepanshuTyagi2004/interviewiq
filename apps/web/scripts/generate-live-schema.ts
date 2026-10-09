// Writes packages/contracts/live-workspace.schema.json from the Zod protocol module.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { workspaceJsonSchema } from '../features/interview-live/protocol/messages'

const out = fileURLToPath(new URL('../../../packages/contracts/live-workspace.schema.json', import.meta.url))
writeFileSync(out, `${JSON.stringify(workspaceJsonSchema(), null, 2)}\n`)
console.log(`wrote ${out}`)
