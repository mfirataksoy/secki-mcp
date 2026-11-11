/**
 * Types shared by the Pages Functions. In Seçki's own repo this file also holds the site's other
 * request helpers (sign-in, same-origin checks); the MCP server only needs these types.
 */

export interface Env {
  /** Static assets of the build (for /data/events.json). */
  ASSETS: Fetcher
  DB: D1Database
  FIREBASE_PROJECT_ID: string
  ASSISTANT_MODEL: string
  ASSISTANT_DAILY_LIMIT: string
  /** Messages per account per day (the assistant needs an account). */
  ASSISTANT_USER_DAILY: string
  /** Pages secret; absent locally. */
  ANTHROPIC_API_KEY?: string
  /** '1': the assistant answers from the search tool without calling Claude (local tests). */
  ASSISTANT_MOCK?: string
  /** Optional salt for IP hashes. */
  IP_SALT?: string
  /** Local tests only ('127.0.0.1:9099'): accept the Firebase Auth emulator's tokens. Never set when deployed. */
  FIREBASE_AUTH_EMULATOR_HOST?: string
}

export type Handler = PagesFunction<Env>
