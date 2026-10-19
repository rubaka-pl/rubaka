import { mapMal } from '@/integrations/mal'

test('MAL API mapping: zero counts are unknown, light novels suggest the Novels category', () => {
  const r = mapMal({
    id: 2, title: 'Berserk', main_picture: { large: 'https://cdn.myanimelist.net/images/manga/1/157897l.jpg' },
    alternative_titles: { en: 'Berserk', ja: 'ベルセルク', synonyms: [] }, start_date: '1989-08-25', status: 'currently_publishing',
    media_type: 'manga', num_chapters: 0, num_volumes: 0, genres: [{ name: 'Action' }], authors: [{ node: { first_name: 'Kentarou', last_name: 'Miura' } }],
  }, 'manga')
  expect(r).toMatchObject({ category: 'manga', format: 'manga', originalTitle: 'ベルセルク', year: 1989, releaseStatus: 'releasing', posterUrl: expect.stringContaining('157897l') })
  expect(r.totals).toEqual({ episodes: null, chapters: null, volumes: null })
  expect(r.details?.authors).toEqual(['Kentarou Miura'])
  expect(r.externalIds[0]).toMatchObject({ provider: 'mal_manga', external_id: '2' })
  expect(mapMal({ id: 9, title: 'LN', media_type: 'light_novel' }, 'manga')).toMatchObject({ category: 'novel', format: 'light_novel' })
})

test('enrichment never writes an end date before the start date', async () => {
  const { sanitizeForCategory } = await import('@/features/enrichment/runner')
  const r = { provider: 'tvmaze' as const, externalId: '1', category: 'tv_series' as const, title: 'X', releaseDate: '2017-01-01', endDate: '2017-06-01', externalIds: [] }
  expect(sanitizeForCategory(r, 'tv_series', { release_date: '2018-02-01' }).endDate).toBeNull()
  expect(sanitizeForCategory(r, 'tv_series', { release_date: '2016-12-01' }).endDate).toBe('2017-06-01')
  expect(sanitizeForCategory(r, 'tv_series').endDate).toBe('2017-06-01')
})
