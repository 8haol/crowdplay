// Keepalive: ping the Supabase project every 5 minutes so the free-tier
// project cannot auto-pause in the run-up to the event.
//
// Usage (run from the evening before the event until the event ends):
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... npx tsx scripts/keepalive.ts
//
// It only reads public station configuration, so the publishable key is enough.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY env vars.");
  process.exit(1);
}

const INTERVAL_MS = 5 * 60 * 1000;

async function ping(): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(`${url}/rest/v1/stations?select=id&limit=1`, {
      headers: { apikey: key!, authorization: `Bearer ${key}` },
    });
    const body = await res.text();
    console.log(
      `[${new Date().toISOString()}] ${res.status} in ${Date.now() - started}ms: ${body}`
    );
  } catch (err) {
    console.error(`[${new Date().toISOString()}] PING FAILED:`, err);
  }
}

console.log(`Keepalive started — pinging ${url} every ${INTERVAL_MS / 60000} min. Ctrl+C to stop.`);
void ping();
setInterval(() => void ping(), INTERVAL_MS);
