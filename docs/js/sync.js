// sync.js — Push/pull progress to Supabase (last-write-wins by updated_at)
import { getClient, getCurrentUser } from './auth.js';
import { db, getAllProgress } from './db.js';

const SYNC_KEY = 'last_sync';
const PROGRESS_TABLE = 'phrase_progress';

export function lastSync() { return localStorage.getItem(SYNC_KEY); }
function setLastSync(ts) { localStorage.setItem(SYNC_KEY, ts); }

export async function syncNow() {
  const client = getClient();
  if (!client) return { ok: false, reason: 'no-config' };
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: 'no-user' };

  const since = lastSync() || '1970-01-01T00:00:00.000Z';

  // === PUSH ===
  const all = await getAllProgress();
  const dirty = all.filter((p) => !p.updated_at || p.updated_at > since);
  if (dirty.length) {
    const rows = dirty.map((p) => ({
      user_id: user.id,
      phrase_id: p.phraseId,
      remember_count: p.rememberCount,
      learn_state: p.learnStateInt,
      next_review: p.nextReview,
      last_reviewed: p.lastReviewed,
      consecutive_wrong: p.consecutiveWrong || 0,
      mastery_score: p.masteryScore,
      updated_at: p.updated_at
    }));
    const { error: pushErr } = await client
      .from(PROGRESS_TABLE)
      .upsert(rows, { onConflict: 'user_id,phrase_id' });
    if (pushErr) return { ok: false, reason: 'push', error: pushErr };
  }

  // === PULL ===
  const { data: remote, error: pullErr } = await client
    .from(PROGRESS_TABLE)
    .select('*')
    .gt('updated_at', since);
  if (pullErr) return { ok: false, reason: 'pull', error: pullErr };

  let pulled = 0;
  if (remote && remote.length) {
    await db.transaction('rw', db.progress, async () => {
      for (const r of remote) {
        const local = await db.progress.get(r.phrase_id);
        if (!local || (local.updated_at && local.updated_at < r.updated_at)) {
          await db.progress.put({
            phraseId: r.phrase_id,
            rememberCount: r.remember_count,
            learnStateInt: r.learn_state,
            nextReview: r.next_review,
            lastReviewed: r.last_reviewed,
            consecutiveWrong: r.consecutive_wrong,
            masteryScore: r.mastery_score,
            updated_at: r.updated_at
          });
          pulled++;
        }
      }
    });
  }

  setLastSync(new Date().toISOString());
  return { ok: true, pushed: dirty.length, pulled };
}
