/**
 * Builds what the /mcp Function reads, from Seçki's public events.json:
 *   public/data/mcp-index.json  (allowlisted fields plus pre-folded search text)
 *   public/llms.txt
 * In Seçki's own repo the same two files are written by the site build (vite prerender).
 *
 *   npm run index                     # fetches https://secki.istanbul/data/events.json
 *   npm run index -- ./events.json    # or reads a local copy
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { buildMcpIndex } from '../server/mcp/indexer.ts'
import { llmsTxt } from '../server/mcp/llms.ts'

const SITE = 'https://secki.istanbul'
const src = process.argv[2]
const data = src
  ? JSON.parse(readFileSync(src, 'utf8'))
  : await fetch(`${SITE}/data/events.json`).then((r) => {
      if (!r.ok) throw new Error(`events.json: HTTP ${r.status}`)
      return r.json()
    })
const index = buildMcpIndex(data)
mkdirSync('public/data', { recursive: true })
writeFileSync('public/data/mcp-index.json', JSON.stringify(index))
writeFileSync('public/llms.txt', llmsTxt(SITE, index))
console.log(`index: ${data.events?.length ?? 0} events -> public/data/mcp-index.json, public/llms.txt`)
