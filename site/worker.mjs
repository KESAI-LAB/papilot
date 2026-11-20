const REFRESH_SECONDS = 15 * 60;
const RETRY_SECONDS = 60;
const RETAIN_SECONDS = 24 * 60 * 60;
const REPOSITORY = 'https://api.github.com/repos/PapilotAI/papilot';
const STARS_PATH = '/api/github-stars';
let refreshing = false;

async function githubStars() {
  try {
    const response = await fetch(REPOSITORY, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Papilot-website' },
      cache: 'no-store', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      const retryAfter = Number.parseInt(response.headers.get('Retry-After'), 10);
      const reset = response.headers.get('X-RateLimit-Remaining') === '0'
        ? Number.parseInt(response.headers.get('X-RateLimit-Reset'), 10) - Math.floor(Date.now() / 1000) : 0;
      return { stars: null, seconds: Math.max(RETRY_SECONDS, retryAfter || 0, reset || 0) };
    }
    const count = (await response.json()).stargazers_count;
    if (Number.isSafeInteger(count) && count >= 0) return { stars: count, seconds: REFRESH_SECONDS };
  } catch {
    // Keep using the cached count when GitHub cannot be reached.
  }
  return { stars: null, seconds: RETRY_SECONDS };
}

function starResponse(stars, refreshAfter) {
  return Response.json({ stars, refreshAfter }, {
    status: stars === null ? 503 : 200,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function stars(request) {
  // All page languages and query strings share one entry at this edge.
  const key = new Request(new URL(STARS_PATH, request.url));
  const retryKey = new Request(new URL(STARS_PATH + '?retry', request.url));
  const cache = caches.default;
  const read = key => cache.match(key).then(response => response?.json()).catch(() => undefined);
  const leading = !refreshing;
  if (leading) refreshing = true;
  try {
    const entry = await read(key);
    const previous = entry?.stars ?? null;
    const secondsLeft = value => Math.ceil(((value?.refreshAt ?? 0) - Date.now()) / 1000);
    const freshFor = secondsLeft(entry);
    if (freshFor > 0) return starResponse(previous, freshFor);
    const retryIn = secondsLeft(await read(retryKey));
    if (retryIn > 0) return starResponse(previous, retryIn);
    // Concurrent requests can use the stale value without sharing another
    // request's I/O. The elected request refreshes and publishes the cache.
    if (!leading) return starResponse(previous, 1);

    const { stars: fresh, seconds } = await githubStars();
    const refreshAt = Date.now() + seconds * 1000;
    // Keep cooldowns separate so an error never overwrites a valid count.
    const [target, value, maxAge] = fresh === null
      ? [retryKey, { refreshAt }, seconds]
      : [key, { stars: fresh, refreshAt }, RETAIN_SECONDS];
    await cache.put(target, Response.json(value, {
      headers: { 'Cache-Control': `public, max-age=${maxAge}` },
    })).catch(() => undefined);
    return starResponse(fresh ?? previous, seconds);
  } finally {
    if (leading) refreshing = false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === STARS_PATH && request.method === 'GET') return stars(request);
    return env.ASSETS.fetch(request);
  },
};
