const PEXELS_BASE = 'https://api.pexels.com';

async function pexelsGet(path, qs) {
  const url = new URL(path, PEXELS_BASE);
  if (qs) Object.entries(qs).forEach(([k,v]) => url.searchParams.set(k, v));
  const r = await fetch(url, { headers: { Authorization: process.env.PEXELS_API_KEY } });
  if (!r.ok) throw new Error(`PEXELS_${r.status}`);
  return r.json();
}

export async function searchStockVideosPortrait({ query, page, perPage = 15 }) {
  const data = await pexelsGet('/videos/search', {
    query, orientation: 'portrait', page, per_page: perPage
  });
  const list = (data?.videos || []).map(v => ({
    id: `pexels-video-${v.id}`,
    kind: 'stockVideo',
    url: (v?.video_files || []).sort((a,b)=> (a.width||0)-(b.width||0)).pop()?.link || '',
    duration: Math.round(v?.duration || 0)
  })).filter(v => v.url);
  const nextPage = data?.page && data?.per_page && data?.total_results
    ? (data.page * data.per_page < data.total_results ? data.page + 1 : null)
    : null;
  return { list, nextPage };
}

export async function searchStockImagesPortrait({ query, page, perPage = 30 }) {
  const data = await pexelsGet('/v1/search', {
    query, orientation: 'portrait', page, per_page: perPage
  });
  const list = (data?.photos || []).map(p => ({
    id: `pexels-${p.id}`,
    kind: 'stock',
    url: p?.src?.large2x || p?.src?.large || p?.src?.portrait || ''
  })).filter(x => x.url);
  const nextPage = data?.page && data?.per_page && data?.total_results
    ? (data.page * data.per_page < data.total_results ? data.page + 1 : null)
    : null;
  return { list, nextPage };
}


