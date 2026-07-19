/* Shared bitmap-background catalogue for the desktop, Appearance and
 * ClackPaint. Curated site.json entries are always available; unregistered
 * files are discovered from the public GitHub repository when possible. */
(() => {
const BITMAP_NAME = /^[a-z0-9][a-z0-9._ -]*\.(?:png|jpe?g|gif|webp|bmp)$/i;
const CACHE_AGE = 30 * 1000;

function displayName(file) {
  const stem = file.replace(/\.[^.]+$/, '');
  if (/^\d+$/.test(stem)) return `Pattern ${stem}`;
  const classic = /^classic-mac-os-tile-wallpapers-(\d+)$/i.exec(stem);
  if (classic) return `Classic Mac OS ${classic[1]}`;
  return stem.replace(/[-_]+/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function normalise(items) {
  const result = [];
  const files = new Set();
  for (const item of items || []) {
    const file = String(typeof item === 'string' ? item : item?.file || '').trim();
    if (!BITMAP_NAME.test(file) || files.has(file.toLowerCase())) continue;
    files.add(file.toLowerCase());
    result.push({ name: String(item?.name || displayName(file)).trim(), file });
  }
  return result;
}

async function list(site) {
  const registered = normalise(site?.backgrounds);
  const repo = String(site?.repo || '');
  const branch = String(site?.branch || 'main');
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(repo) || !/^[a-z0-9._/-]+$/i.test(branch)) return registered;

  const cacheKey = `clackos-backgrounds:${repo}@${branch}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey));
    if (cached && Date.now() - cached.time < CACHE_AGE) return normalise([...registered, ...cached.items]);
  } catch {}

  try {
    const endpoint = `https://api.github.com/repos/${repo}/contents/assets/backgrounds?ref=${encodeURIComponent(branch)}`;
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const items = (await response.json()).filter(item => item?.type === 'file').map(item => ({ file: item.name }));
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ time: Date.now(), items })); } catch {}
    return normalise([...registered, ...items]);
  } catch (error) {
    console.warn('Could not discover additional website backgrounds:', error);
    return registered;
  }
}

window.ClackOSBackgrounds = { list, normalise, displayName };
})();
