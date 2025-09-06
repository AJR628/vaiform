import { randomUUID } from 'crypto';

const BANK = {
  calming: [
    { text: 'Still water reflects the sky without effort.', author: null },
    { text: 'Quiet breaths make room for wiser thoughts.', author: null },
    { text: 'Soft focus steadies even the shaking hand.', author: null },
  ],
  confident: [
    { text: 'Walk as if the path chose you first.', author: null },
    { text: 'Certainty grows where effort returns daily.', author: null },
    { text: 'Small wins train the voice that says go.', author: null },
  ],
  hopeful: [
    { text: 'Dawn does not ask permission to begin.', author: null },
    { text: 'A seed believes before it breaks ground.', author: null },
    { text: 'Light learns our names by staying.', author: null },
  ],
  grit: [
    { text: 'Blisters are bookmarks in the work.', author: null },
    { text: 'Carry the brick; the wall appears.', author: null },
    { text: 'Finish lines are made of steps.', author: null },
  ]
};

function pick(arr, n) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export function curatedByFeeling(feeling, count, excludeTextsNorm = new Set()) {
  const key = (feeling || '').toLowerCase();
  const pool = BANK[key] || [].concat(...Object.values(BANK));
  const fresh = pool.filter(q => !excludeTextsNorm.has(q.text.toLowerCase()));
  const chosen = pick(fresh.length ? fresh : pool, count);
  return chosen.map(q => ({
    id: `q-${randomUUID()}`,
    text: q.text,
    author: q.author || null,
    attributed: !!q.author,
    isParaphrase: false
  }));
}


