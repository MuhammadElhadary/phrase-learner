// srs.js — Spaced Repetition Scheduling
// Based on RememberCount -> interval ladder (in days)

const INTERVALS = [0, 1, 3, 7, 14, 30, 60, 120]; // index = rememberCount
const TODAY = () => new Date().toISOString().slice(0, 10);

function addDays(dateISO, days) {
  const d = new Date(dateISO);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Called on a CORRECT answer
export function onCorrect(p) {
  p.rememberCount = Math.min(p.rememberCount + 1, INTERVALS.length - 1);
  const interval = INTERVALS[p.rememberCount];
  p.nextReview = addDays(TODAY(), interval);
  p.lastReviewed = TODAY();
  p.consecutiveWrong = 0;
  p.masteryScore = Math.min(100, p.masteryScore + (100 - p.masteryScore) * 0.15);

  // learnStateInt: 0=new, 1=learning, 2=known
  if (p.rememberCount >= 2) p.learnStateInt = 2;
  else if (p.rememberCount >= 1) p.learnStateInt = 1;
  return p;
}

// Called on a WRONG answer
export function onWrong(p) {
  p.rememberCount = 0;
  p.consecutiveWrong = (p.consecutiveWrong || 0) + 1;
  p.nextReview = addDays(TODAY(), 1);
  p.lastReviewed = TODAY();
  p.learnStateInt = 1;
  p.masteryScore = Math.max(0, p.masteryScore * 0.6);
  return p;
}

// Build today's review queue: due-for-review phrases + a slice of new
export async function buildQueue(db, { reviews = 20, newPhrases = 10 } = {}) {
  const today = TODAY();
  const due = await db.progress
    .where('nextReview')
    .belowOrEqual(today)
    .toArray();
  // Stable shuffle
  const shuffledDue = due.sort(() => Math.random() - 0.5).slice(0, reviews);
  const fresh = await db.phrases
    .filter((p) => p.learnStateInt === 0)
    .limit(newPhrases)
    .toArray();
  return { reviews: shuffledDue, new: fresh };
}
