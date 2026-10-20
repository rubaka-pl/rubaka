// RUBAKA — export your nhentai favourites for Import (Doujinshi).
// Open https://nhentai.net/favorites/ (signed in), press F12 → Console, paste
// this, press Enter. It reads every favourites page and the gallery details
// from nhentai's own API in your browser, then downloads
// nhentai-favorites.json — import it in RUBAKA → Import.
// Galleries tagged with minors (lolicon / shotacon / toddlercon …) are skipped.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const banned = /loli|shota|toddler/i
  const items = new Map()
  const grab = (doc) => doc.querySelectorAll('.gallery a.cover, a[href^="/g/"]').forEach((a) => {
    const m = a.getAttribute('href').match(/^\/g\/(\d+)\//)
    if (!m || items.has(m[1])) return
    const img = a.querySelector('img')
    items.set(m[1], { id: m[1], thumb: img?.dataset?.src || img?.getAttribute('src') || null })
  })
  const page = (n) => fetch(`/favorites/?page=${n}`, { credentials: 'include' }).then((r) => r.text()).then((h) => new DOMParser().parseFromString(h, 'text/html'))
  const first = await page(1)
  grab(first)
  const last = Math.max(1, ...[...first.querySelectorAll('.pagination a')].map((a) => +new URL(a.href, location.href).searchParams.get('page') || 1))
  for (let p = 2; p <= last; p++) { grab(await page(p)); console.log(`page ${p}/${last}`); await sleep(300) }
  console.log(`${items.size} favourites, reading details…`)

  const out = []
  let skipped = 0
  let i = 0
  for (const it of items.values()) {
    i++
    let g = null
    for (let attempt = 0; attempt < 4 && !g; attempt++) {
      const r = await fetch(`/api/gallery/${it.id}`, { credentials: 'include' })
      if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue }
      if (r.ok) g = await r.json()
      else break
    }
    if (!g) { console.warn('no details for', it.id); continue }
    if ((g.tags ?? []).some((t) => banned.test(t.name))) { skipped++; continue }
    out.push({
      id: g.id, media_id: g.media_id, title: g.title, num_pages: g.num_pages, upload_date: g.upload_date,
      tags: (g.tags ?? []).map((t) => ({ type: t.type, name: t.name })), thumb: it.thumb,
    })
    if (i % 25 === 0) console.log(`${i}/${items.size}`)
    await sleep(350)
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }))
  a.download = 'nhentai-favorites.json'
  a.click()
  console.log(`Done: ${out.length} galleries saved${skipped ? `, ${skipped} skipped (minors)` : ''}.`)
})()
