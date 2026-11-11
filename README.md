# Seçki İstanbul MCP server

> **This repo is a read-only mirror** of the MCP module from Seçki İstanbul's private repository (the site's
> data pipeline and personal settings stay private). The live server is `https://secki.istanbul/mcp`.
> Paths here match the original layout: `functions/` are Cloudflare Pages Functions, `server/mcp/` is the
> server, and `server/events.ts`, `server/http.ts` and `src/lib/*` are the few site helpers it uses.
>
> **Run it locally** (Node ≥ 22.13):
>
> ```sh
> npm install
> npm test && npm run typecheck
> npm run index        # builds public/data/mcp-index.json and public/llms.txt from the public events.json
> npm run dev          # wrangler pages dev on http://localhost:8791
> npm run smoke        # in a second terminal: protocol smoke test against the local server
> ```


A public, read-only MCP server for [Seçki İstanbul](https://secki.istanbul), a curated, daily-refreshed list of upcoming public events in Istanbul. No sign-in, no accounts, no write tools.

- **URL:** `https://secki.istanbul/mcp` (Streamable HTTP, stateless)
- **Protocol:** `2026-07-28` (`server/discover`, per-request `_meta`) and the legacy `initialize` handshake (`2025-11-25`, `2025-06-18` and `2025-03-26` were each checked locally and echoed back; the SDK also accepts `2024-11-05`). One JSON-RPC message per POST: batches are refused with 400.
- **Tools:** `search_events` and `get_event`
- **Built with:** the official TypeScript SDK `@modelcontextprotocol/server` 2.4.0 and zod 4.6.7, pinned exactly, as a Cloudflare Pages Function

## Connect in 1 minute

Server URL: `https://secki.istanbul/mcp` (no sign-in, read-only)

**Claude Code**

```sh
claude mcp add --transport http --scope user secki https://secki.istanbul/mcp
```

`--scope user` makes it available in every project; leave it out to add it only to the current one. Check with `claude mcp list`, or `/mcp` inside Claude Code. Then ask: "Bu hafta sonu Kadıköy'de ne var?" or "Any jazz in Istanbul next week?"

**Claude (claude.ai / Claude Desktop):** Settings → Connectors → Add custom connector → URL `https://secki.istanbul/mcp` → no authentication.

**Cursor:** `~/.cursor/mcp.json`

```json
{ "mcpServers": { "secki": { "url": "https://secki.istanbul/mcp" } } }
```

**VS Code:** `.vscode/mcp.json`

```json
{ "servers": { "secki": { "type": "http", "url": "https://secki.istanbul/mcp" } } }
```

**Check it without a client** (MCP Inspector CLI, needs Node `^22.23.4 || ^24.22.1 || >=26.12.1`):

```sh
npx @modelcontextprotocol/inspector --cli https://secki.istanbul/mcp --transport http --method tools/list
```

> Status: the server is not deployed yet. Every command above was run against a local `wrangler pages dev` copy (see [Run it locally](#run-it-locally)); only the Inspector CLI was run end to end. The Claude Code, Claude Desktop, Cursor and VS Code steps follow each client's documented syntax but must be checked by hand against the live URL before this section is published.

## Tools

Both tools carry `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`, and both have an `outputSchema`. Results come as `structuredContent` plus one compact text block (not a JSON dump), so models without structured-output support still get a readable answer.

### `search_events`

Finds upcoming events by any mix of:

| Argument | Meaning |
|---|---|
| `when` | `today`, `tonight`, `tomorrow`, `tomorrow_evening`, `this_weekend`, `next_weekend`, `this_week`, `next_week`, `next_7_days`, `this_month`, `next_30_days`, computed in Istanbul time (UTC+3). `tonight` and `tomorrow_evening` start at 17:00 and leave out exhibitions and all-day runs |
| `date_from`, `date_to` | `YYYY-MM-DD` (Istanbul calendar dates); a past `date_from` is moved to today and the `hint` says so (with "Did you mean 2026-11-14?" for a wrong year) |
| `query` | words that must all start a word in the title, venue, neighbourhood, district, its ilçe (`Kadıköy` finds Moda, `districts.ts`), category, workshop type, or the genre label of the note (`Caz konseri`); ignores case and Turkish accents (`kadikoy` finds `Kadıköy`); a few English words map to Turkish and back (`jazz` ↔ `caz`) |
| `categories` | `konser`, `tiyatro`, `sanat`, `akademik`, `kultur`, `teknoloji`, `doga`, `yoga`, `sosyal`, `fuar`, `atolye` (includes courses), `kurs`, `dans`, `spor`, `gece`, `diger` |
| `side` | `avrupa` (European side) or `anadolu` (Asian side) |
| `free_only`, `max_price_tl` | price filters; events with no stated price are left out (and the `hint` says how many) |
| `language` | two-letter code (`en`, `tr`); only events whose language is known (about 46 of 1,972 on 2026-11-10) |
| `registration` | `opening_soon` (sign-up not open yet; the flag gives the opening time) or `open` |
| `include_sold_out` | sold-out and full events are hidden by default |
| `sort` | `best` (Seçki's editorial ranking, the default) or `soonest` |
| `limit`, `cursor` | 1–20 per page (default 10); `next_cursor` for the next page |

A show with several dates appears once, with `dates` = its number of dates in the range. A single event that has started is left out, unless its end time is listed and not reached yet; then it is flagged `in progress (started 14:00)`. An overnight event (ending before 06:00 the next day) counts on its start day. In `soonest` order an event without a start time comes after the timed ones of its day.

Zero results is not an error: the result has `total: 0` and a `hint` that says, per active filter, how many events dropping just that filter would give (`Without "free_only": 2 events.`), how many each query word finds alone, and how many sold-out events were hidden. All counts are per show, like `total`. Query words that ask for something out of scope (`çocuk`, `kids`, `dj`) or that are really filters (`free`, `ücretsiz`, `english`) add a hint that says so.

### `get_event`

Takes an id from `search_events` (`"e" + 11 hex`; an id missing its `e` also works) or a `secki.istanbul/etkinlik/…` link or slug (also with non-ASCII or percent-encoded letters). Returns a `status` (`scheduled`, `in_progress`, `ended` for an event whose end time passed earlier today, `sold_out`, `full`; Seçki does not track cancellations and says so), exact start and end, venue and city side, price, Seçki's short Turkish editorial `note` (why it is listed, not a description), language, doors, workshop type, registration window, up to three nearby transit stops with line mode (`Taksim (M2 metro, F1 funicular; 1 min walk)`), up to 12 other dates of a repeating show, the ticket page when tickets are sold online, the organiser's page (`info_url`) and the secki.istanbul page. Ids can change when the daily list is rebuilt; with a link, an old id still finds the event by its title (`resolved_by: "title"`). When the title part of a link does not match the event its id found, `warning` says so.

### What is not listed

The list is curated. Children's events, DJ sets and club nights, and ceremonies are filtered out by the pipeline, and the instructions, the tool descriptions, `llms.txt` and the search `hint` say so, so an agent can explain an empty answer. About 70% of events state no price and about 12% have no district (counted on the 2026-11-10 data), which is why the price and side filters leave many events out.

## Errors an agent can recover from

Tool errors come back as results with `isError: true`. Each one names the problem, shows valid input and says what to do next. The texts are in `messages.ts`.

| Case | Message (shortened) |
|---|---|
| `date_to` before `date_from` | `date_to (…) is before date_from (…). Swap them, or send only date_from.` |
| `when` plus dates | `Use either "when" or date_from/date_to, not both. Examples: …` |
| `date_to` in the past | `date_to (2026-11-01) is in the past. … today in Istanbul is 2026-11-10. …` |
| no searchable word | `query "?!" has no searchable words …` |
| bad, stale, foreign or past-the-end cursor, or a new day | `Repeat the search without "cursor" …` |
| unknown id | `No upcoming event matches "…". It may have ended or been removed, or the id is wrong; … To look for it by name, call search_events {"query":"kizilay kan bagisi"}.` (the words come from the link) |
| not an id or link | `"Bülent Ortaçgil" is not an event id or a secki.istanbul event link. Ids look like "e0123456789a" … To find an event by name, call search_events {"query":"Bülent Ortaçgil"}.` |
| data file down | `Event data is temporarily unavailable (…). This is a problem on Seçki's side, not with your request; retry in about 30 seconds.` |
| bad arguments | zod messages written for agents, with a suggestion where one is clear: `"concert" is not a category; use "konser".`, `"weekend" is not a "when" value; did you mean "this_weekend"?`, `max_price_tl must be a JSON number: send 1000, not "1000".`, `limit must be 1-20.`, `2026-02-30 is not a real calendar date.` Unknown keys are refused. The schemas stay strict (no coercion), so their JSON Schema is unchanged. |

HTTP-level answers, in this order:
- `403` (JSON-RPC `-32000`) for an `Origin` that is present and not allowed, on every method. One allowlist decides both the 403 and the CORS headers: `https://secki.istanbul`, `https://www.secki.istanbul`, and `http(s)://localhost`, `127.0.0.1` or `[::1]` on any port. A request without `Origin` (CLIs, desktop apps, servers) is accepted without CORS headers.
- `405` with `Allow: POST, OPTIONS` and a short text for GET/DELETE/PUT/PATCH (also what a person sees in a browser).
- `429` with `Retry-After` from the per-isolate limiter; `413` above 64 KB.
- `400`/`-32600` for a JSON array body: JSON-RPC batching was removed from MCP in 2025-06-18, and the SDK's lenient legacy path would otherwise let one rate-limit token buy up to 100 tool calls.
- `404`/`-32601` for a well-formed `subscriptions/listen` (this server has nothing to notify, so it never holds a stream open). A listen with an unknown protocol version, a mismatched `Mcp-Method` or no id goes to the SDK, which answers `-32022`, `-32020` or `202` and opens no stream either (handler tests).

Protocol errors (`-32020` header mismatch, `-32022` unsupported version, `406` wrong `Accept`) come from the SDK unchanged. Legacy-era answers are always one SSE event (`text/event-stream`), whatever `responseMode` says: SDK 2.4.0 passes `responseMode` only to the modern path. Modern answers are `application/json`. `responseMode` stays `'auto'` because `'json'` prints a console warning per isolate and would not change legacy answers.

## Behaviour under load

- **Idempotent and cheap.** Both tools are reads from memory. The build writes a slim index (`/data/mcp-index.json`, about 0.9 MB for 1,972 events: allowlisted fields plus pre-folded search text) so a cold isolate parses that instead of the 2 MB `events.json` and folds no text. On an M-series Mac, `JSON.parse` of the index took about 2–2.6 ms against 6.7 ms for `events.json`. The index is kept for 10 minutes per isolate; the SDK handler is built once per isolate and the JSON Schemas of the tools are converted once.
- **Cache hints.** `server/discover` and `tools/list` carry `ttlMs: 86400000` and `cacheScope: "public"`: the tool list changes only on deploy.
- **Rate limit inside the app.** A token bucket per client IP (40 requests burst, 4 per second sustained), kept in memory per isolate. Honest scope: it stops one client that hammers the endpoint through one isolate (a loop, a misbehaving agent). It does **not** limit distributed traffic, does not share state between isolates or data centres, and does **not** protect the Workers Free-plan quota (100,000 requests a day, shared with the site's other Functions).
- **Recommended outer limit (not created; a Cloudflare dashboard step for the site owner):** one WAF rate-limiting rule on `secki.istanbul`, path equals `/mcp`, about 20–30 requests per 10 seconds per IP, block for 10 seconds (the Free plan allows one such rule, a 10 s period and IP counting only). Cloudflare's 429 is not produced by this code; MCP clients treat it as a transport error. Note that claude.ai users may share egress IPs, so watch for 429s after launch.
- **Response size.** A `search_events` page stays under 16,000 characters (structured plus text; the largest of 319 pages over 12 searches on the 2026-11-10 data was 14,192) and a `get_event` result under 4 KB (largest 2,853). Tests assert both.

## Privacy

- The server reads only `/data/mcp-index.json`, which the build writes field by field from an allowlist. It never reads the profile, `hidden`, alerts, watch list, flights, campaigns, `health.json`, `state.json` or D1. Source names, scores, coordinates, images, parking and series ids never leave the build; the index keeps only an editorial rank number and a small series group number.
- The religious category (`din`) is published as `kultur` / "Kültür" (KVKK art. 6), as on the website.
- Nothing is logged: no request bodies, arguments or queries, and the SDK's `onerror` is a no-op. The site's existing privacy notice (`/kvkk/`) already covers Cloudflare's own request logs.
- Event titles, venues and notes are third-party text. They are stripped of control characters and cut to 160 (titles) and 300 (notes) characters, and never put into the instructions or tool descriptions. That lowers the prompt-injection risk; it cannot remove it.

## curl transcripts (captured locally, 2026-11-10)

Against `npx wrangler pages dev dist-demo --port 8797` with that day's events (1,972 dated listings). Long lines are cut where marked `…`.

**Legacy handshake** (2025-11-25; the answer comes as one SSE event):

```text
$ curl -sS -i http://127.0.0.1:8797/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
HTTP/1.1 200 OK
Content-Type: text/event-stream

event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"secki-istanbul","title":"Seçki İstanbul","version":"1.0.0"},"instructions":"Seçki İstanbul (secki.istanbul) lists upcoming public events in Istanbul, Turkey: …"},"jsonrpc":"2.0","id":1}
```

**Modern discovery** (2026-07-28):

```text
$ META='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}'
$ curl -sS -i http://127.0.0.1:8797/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: server/discover' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"server/discover\",\"params\":{$META}}"
HTTP/1.1 200 OK
Content-Type: application/json

{"result":{"supportedVersions":["2026-07-28"],"capabilities":{"tools":{"listChanged":false}},"instructions":"…","resultType":"complete","ttlMs":86400000,"cacheScope":"public","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"secki-istanbul","title":"Seçki İstanbul","version":"1.0.0"}}},"jsonrpc":"2.0","id":1}
```

**`search_events "caz"`, modern** (`Mcp-Name` mirrors the tool name; "caz" also finds English "Jazz" titles and notes that start "Caz konseri"). The text block:

```text
$ curl -sS http://127.0.0.1:8797/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2026-07-28' \
    -H 'mcp-method: tools/call' -H 'mcp-name: search_events' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"search_events\",\"arguments\":{\"query\":\"caz\",\"limit\":3},$META}}"

58 events in Istanbul for upcoming days (Salı, 10 Kasım 2026 and later). Showing 1-3, best first.
1. [eae071227311] Tomot Shkoza Trio | Çarşamba, 18 Kasım 2026, 21:30 | Nardis Jazz Club, Galata (avrupa) | Konser | 1.000 TL | international artist | https://secki.istanbul/etkinlik/tomot-shkoza-trio-eae071227311
2. [e8b74cbce8fa] Russions Trio | Salı, 1 Aralık 2026, 21:30 | Nardis Jazz Club, Galata (avrupa) | Konser | 1.000 TL | international artist | https://secki.istanbul/etkinlik/russions-trio-e8b74cbce8fa
3. [e52d5bb4664a] Jazzy By Su Soley | Cumartesi, 14 Kasım 2026, 21:00 | Zorlu PSM, Touché By N Kolay, Zincirlikuyu (avrupa) | Konser | price not stated | international artist | https://secki.istanbul/etkinlik/jazzy-by-su-soley-e52d5bb4664a
More: call search_events again with the same filters and cursor="eyJvIjozLCJ2IjoiMjAyNi0xMS0xMFQxNzoyNzo0NyswMzowMCIsInIiOiIyMDI2LTExLTEwfCIsImYiOiIxaHcyODM2In0".
```

The first event in `structuredContent`:

```json
{
  "id": "eae071227311",
  "title": "Tomot Shkoza Trio",
  "when": "Çarşamba, 18 Kasım 2026, 21:30",
  "start": "2026-11-18T21:30",
  "venue": "Nardis Jazz Club",
  "district": "Galata",
  "side": "avrupa",
  "category": "konser",
  "category_label": "Konser",
  "price": "1.000 TL",
  "is_free": false,
  "flags": ["international artist"],
  "url": "https://secki.istanbul/etkinlik/tomot-shkoza-trio-eae071227311"
}
```

**Zero results with a hint**, legacy era (`{"date_from":"2026-11-14","date_to":"2026-11-14","query":"Kadıköy","categories":["konser"],"free_only":true}`):

```text
0 events in Istanbul for these dates (Cumartesi, 14 Kasım 2026).
Hint: No events match all filters. Without "categories": 3 events. Without "free_only": 2 events. "Kadıköy" alone has 285 upcoming events (next: Salı, 10 Kasım 2026). 2 events in this range do not state a price, so the price filter left them out.
```

**`get_event` with an old id in the link, legacy era** (no handshake needed: the server is stateless):

```text
$ curl -sS http://127.0.0.1:8797/mcp -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-11-25' \
    -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_event","arguments":{"id":"https://secki.istanbul/etkinlik/tomot-shkoza-trio-e00000000000"}}}'

[eae071227311] Tomot Shkoza Trio | Çarşamba, 18 Kasım 2026, 21:30 | Nardis Jazz Club, Galata (avrupa) | Konser | 1.000 TL
Resolved by title: the id in the link is old; the current id is eae071227311.
Status: scheduled, as of the list of 2026-11-10 17:27. Seçki does not track cancellations; confirm on the organiser's page.
Note: Yabancı caz
Flags: international artist
Info: https://www.nardisjazz.com/etkinlik/tomot-shkoza-trio/
Transit: Şişhane (M2 metro; 5 min walk); Tünel (F2 funicular; 6 min walk); Karaköy İskelesi (ferry pier; 9 min walk)
Page: https://secki.istanbul/etkinlik/tomot-shkoza-trio-eae071227311
```

**Recoverable errors** (text of the `isError` result):

```text
arguments {"date_from":"2026-02-30"}
→ Input validation error: Invalid arguments for tool search_events: date_from: 2026-02-30 is not a real calendar date.

arguments {"categories":["concert"]}
→ Input validation error: Invalid arguments for tool search_events: categories.0: "concert" is not a category; use "konser". categories must be from: konser, gece, …

arguments {"date_to":"2025-11-14"}
→ date_to (2025-11-14) is in the past. Seçki lists upcoming events only; today in Istanbul is 2026-11-10. Did you mean 2026-11-14? Use a date on or after today, or use "when".
```

**A browser or a GET:**

```text
$ curl -sS -i http://127.0.0.1:8797/mcp
HTTP/1.1 405 Method Not Allowed
Content-Type: text/plain; charset=utf-8
Allow: POST, OPTIONS
Cache-Control: no-store

This is the Seçki İstanbul MCP endpoint. Connect an MCP client to https://secki.istanbul/mcp (POST, Streamable HTTP, no sign-in). Docs: https://secki.istanbul/llms.txt
```

## Run it locally

Node 24.22.1 (wrangler 4.156 needs Node 22+, the Inspector `^24.22.1`):

```sh
cd web
mkdir -p public-demo/data && cp public/favicon.svg public-demo/ && cp -R public/kvkk public-demo/
cp <a copy of https://secki.istanbul/data/events.json> public-demo/data/events.json   # public-demo/ is gitignored
npm run build:demo                                   # also writes dist-demo/data/mcp-index.json and dist-demo/llms.txt
npx wrangler pages dev dist-demo --port 8791         # all bindings local; /mcp needs none of them
bash scripts/mcp-smoke.sh http://127.0.0.1:8791      # 19 protocol checks, both eras
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8791/mcp --transport http --protocol-era modern --method tools/list --strict
npx @modelcontextprotocol/inspector --cli http://127.0.0.1:8791/mcp --transport http --protocol-era legacy \
  --method tools/call --tool-name search_events --tool-arg when=this_weekend --tool-arg limit=3
```

The same gate as the daily workflow: `npm ci && npm test && npx tsc -p functions/tsconfig.json && npm run build && npm run build:demo`. With a real `public-demo/data/events.json` present, `npm test` also runs every event of that file through both output schemas.

`--strict` reports 0 errors and 9 warnings: the nullable output fields (`venue`, `district`, `price`, `is_free`, `range.to`) are emitted by zod as `type: ["string","null"]`, which is legal JSON Schema but less portable to single-type dialects. The input schemas have no findings.

## Files

| File | Role |
|---|---|
| `web/functions/mcp.ts` | the Pages route for `/mcp` and `/mcp/` |
| `web/functions/.well-known/[[path]].ts` | a JSON 404 for `/.well-known/*` instead of the SPA's HTML 200 |
| `web/functions/llms-full.txt.ts` | `/llms-full.txt` → 301 to `/llms.txt` (instead of the SPA's HTML 200) |
| `server.ts` | `handleMcp`: Origin check, CORS preflight and method gate, rate limit, bounded body, refusal of batches and of `subscriptions/listen`, then the SDK handler (built once per isolate) |
| `tools.ts` | zod 4 schemas, the final descriptions, thin handlers |
| `query.ts` | filter, rank, series collapse, pagination, public shapes, id and link resolution (no SDK import) |
| `indexer.ts` | the build-time allowlisted index (called from `web/vite.config.ts`) |
| `data.ts` | loads and caches `/data/mcp-index.json` |
| `time.ts`, `match.ts`, `categories.ts`, `messages.ts`, `ratelimit.ts` | Istanbul clock, word matching, public categories, agent-facing texts, token buckets |
| `districts.ts` | neighbourhood → ilçe (Moda → Kadıköy), for search and for the side of a neighbourhood `geo.ts` does not list |
| `llms.ts` | `/llms.txt` text (counts from the index, the tools, the `when` values, categories, examples, known gaps), written by the demo prerender |
| `fixtures/events.ts`, `query.test.ts`, `handler.test.ts` | vitest: about 20 hand-written events plus a live-shaped check |
| `web/scripts/mcp-smoke.sh` | curl smoke test against any base URL |

The module imports a few small helpers from the rest of the site (`web/src/lib/{text,price,geo,eventUrl,prerender}.ts` and the `Env`/`Handler` types from `web/server/http.ts`), so a copy of this folder alone does not build. A public mirror would have to vendor those files or be labelled a read-only mirror of the module.
