import { ensure as storeEnsure } from './store.js';

export function ensureStudio(required = true) {
  return function handler(req, res, next) {
    const headerId = req.headers['x-studio-id'];
    const bodyId = req.body?.studioId;
    const queryId = req.query?.studioId;
    const raw = headerId ?? bodyId ?? queryId ?? '';
    const id = String(raw || '').trim();

    let src = 'missing';
    if (headerId) src = 'header'; else if (bodyId) src = 'body'; else if (queryId) src = 'query';

    if (!id) {
      if (process.env.DEBUG_STUDIO === '1') console.log('[studio] id=<missing> src='+src+' missing');
      if (required) return res.status(400).json({ success:false, error:'STUDIO_ID_MISSING' });
      return next();
    }
    const studio = storeEnsure(id);
    if (!studio) return res.status(500).json({ success:false, error:'STUDIO_ENSURE_FAILED' });
    req.studioId = id;
    req.studio = studio;
    if (process.env.DEBUG_STUDIO === '1') console.log('[studio][ensure]', req.studioId);
    next();
  };
}

export default { ensureStudio };


