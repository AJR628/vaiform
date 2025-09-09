import { getOrCreate } from './store.js';

export function ensureStudio(req, res, next) {
  const id = String(
    req.body?.studioId ??
    req.query?.studioId ??
    req.headers['x-studio-id'] ??
    ''
  ).trim();

  if (!id) {
    return res.status(400).json({ success: false, error: 'BAD_REQUEST', detail: 'studioId required' });
  }

  const studio = getOrCreate(id);
  req.studio = studio;
  req.studioId = studio.id;

  if (process.env.DEBUG_STUDIO === '1') {
    console.log('[studio][ensure]', { id: req.studioId });
  }
  next();
}

export default { ensureStudio };


