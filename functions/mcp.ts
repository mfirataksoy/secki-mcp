/**
 * https://secki.istanbul/mcp (and /mcp/): the public, read-only Seçki İstanbul MCP server. No sign-in.
 * Everything is in web/server/mcp/ (server.ts, tools.ts, query.ts); docs in web/server/mcp/README.md.
 */
import type { Handler } from '../server/http.ts'
import { handleMcp } from '../server/mcp/server.ts'

export const onRequest: Handler = ({ request, env }) => handleMcp(request, env)
