// Hits the real APIs once each. Not a test — run it by hand:
//   npm run check:live   (credentials from env, or `raincheck configure`)
//
// Verifies: both tokens work, the Raindrop list endpoint returns the documented
// fields (and whether `highlights` is inlined), and a single Jev call with our
// real questions returns the expected answer shapes.

import { loadConfig, resolveSecret } from '../src/config.ts'
import { createClaudeSessionsInterestSource } from '../src/interests/claude-sessions.ts'
import { createJevClient } from '../src/jev/client.ts'
import { JEV_MODEL, QUESTIONS, buildState } from '../src/questions.ts'
import { createRaindropSource } from '../src/raindrop/source.ts'

const config = await loadConfig({ warn: console.warn })
const apiKey = resolveSecret('TYPESAFE_API_KEY', config.typesafeApiKey)
const token = resolveSecret('RAINDROP_TOKEN', config.raindropToken)
if (!apiKey || !token) {
  console.error('set TYPESAFE_API_KEY and RAINDROP_TOKEN, or write ~/.config/raincheck/config.json')
  process.exit(2)
}

// Raw first page, before the adapter, so undocumented fields are visible too.
const raw = await fetch('https://api.raindrop.io/rest/v1/raindrops/0?perpage=5&page=0', {
  headers: { Authorization: `Bearer ${token}` },
})
console.log(`raindrop: HTTP ${raw.status}`)
const page = (await raw.json()) as { items?: Record<string, unknown>[] }
const first = page.items?.[0]
if (!first) {
  console.log('raindrop: no bookmarks returned')
  process.exit(1)
}
console.log('raindrop: fields on first bookmark:', Object.keys(first).sort().join(', '))
console.log(
  'raindrop: highlights inlined in list response:',
  page.items!.some((i) => Array.isArray(i.highlights) && i.highlights.length > 0)
    ? 'yes (at least one bookmark has some)'
    : 'not observed in the first 5 bookmarks — check a bookmark you know has highlights',
)

const source = createRaindropSource({ token })
let bookmark
for await (const it of source.fetch({ limit: 1 })) bookmark = it
if (!bookmark) {
  console.log('adapter: nothing mapped')
  process.exit(1)
}
console.log('adapter: first bookmark →', JSON.stringify(bookmark, null, 2))

const recentWork = await createClaudeSessionsInterestSource().load()
console.log(`sessions: digest is ${recentWork.length} chars (see \`raincheck context\` for the text)`)
const jev = createJevClient({ apiKey, model: JEV_MODEL })
const res = await jev.ask(buildState(recentWork, bookmark), QUESTIONS)
console.log(`jev: model=${res.model} usage=${JSON.stringify(res.usage)}`)
for (const [id, a] of Object.entries(res.answers)) {
  console.log(`jev: ${id} →`, JSON.stringify(a))
}
