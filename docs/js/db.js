// db.js — IndexedDB schema + phrase seed loader (Dexie via CDN)
import Dexie from 'https://esm.sh/dexie@4.0.8';

export const db = new Dexie('PhraseLearnerDB');

db.version(2).stores({
  phrases:    'wordId, level, rank, score, learnStateInt',
  progress:   '&phraseId, updated_at, nextReview, learnStateInt',
  dailyStats: '&date',
  meta:       '&key'
});

// === Seed phrases from bundled JSON (runs once) ===
export async function loadPhrases() {
  const seeded = await db.meta.get('seeded');
  if (seeded) return db.phrases.count();

  // Load from GitHub raw CDN (keeps deployment tiny; cached by SW after first load)
  const res = await fetch('https://raw.githubusercontent.com/MuhammadElhadary/phrase-learner/main/assets/phrases.json');
  if (!res.ok) throw new Error('Failed to load phrases.json (HTTP ' + res.status + ')');
  const data = await res.json();

  // Normalize: id field, strip fields we don't need, batch-insert
  const rows = data.map((p) => ({
    wordId: p.wordId,
    rank: p.rank,
    text: p.text,
    otherForms: p.otherForms || '',
    meaning: p.meaning,
    level: p.level,
    score: p.score,
    type: p.type,
    example: p.example || '',
    misspellings: p.misspellings || [],
    learnStateInt: 0  // 0=new, 1=learning, 2=known — start fresh
  }));

  // Bulk add in chunks of 1000 to avoid memory spikes
  await db.transaction('rw', db.phrases, async () => {
    for (let i = 0; i < rows.length; i += 1000) {
      await db.phrases.bulkPut(rows.slice(i, i + 1000));
    }
  });

  await db.meta.put({ key: 'seeded', value: new Date().toISOString() });
  return rows.length;
}

// === Progress helpers ===
export async function getProgress(phraseId) {
  return (await db.progress.get(phraseId)) || {
    phraseId,
    rememberCount: 0,
    learnStateInt: 0,
    nextReview: null,
    lastReviewed: null,
    consecutiveWrong: 0,
    masteryScore: 50.0,
    updated_at: null
  };
}

export async function setProgress(p) {
  p.updated_at = new Date().toISOString();
  await db.progress.put(p);
}

export async function getAllProgress() {
  return db.progress.toArray();
}

// === Stats ===
export async function getDailyStats(dateISO) {
  return (await db.dailyStats.get(dateISO)) || {
    date: dateISO,
    points: 0, reviewed: 0, correct: 0, wrong: 0, newLearned: 0
  };
}

export async function bumpDailyStats(dateISO, patch) {
  const cur = await getDailyStats(dateISO);
  const next = { ...cur, ...patch };
  await db.dailyStats.put(next);
  return next;
}

// === Reset (settings) ===
export async function resetAll() {
  await db.delete();
  location.reload();
}
