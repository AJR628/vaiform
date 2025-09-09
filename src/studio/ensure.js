import { getStudio } from './store.js';

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
      if (required) return res.status(400).json({ success:false, error:'STUDIO_NOT_FOUND' });
      return next();
    }

    const studio = getStudio(id);
    if (!studio && required) {
      if (process.env.DEBUG_STUDIO === '1') console.log('[studio] id='+id+' src='+src+' missing');
      return res.status(400).json({ success:false, error:'STUDIO_NOT_FOUND' });
    }

    req.studioId = id;
    if (studio) req.studio = studio;
    if (process.env.DEBUG_STUDIO === '1') console.log('[studio] id='+id+' src='+src+' '+(studio?'ok':'missing'));
    next();
  };
}

export default { ensureStudio };


