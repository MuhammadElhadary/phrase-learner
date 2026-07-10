// views.js — Browse → Learn → Revise flow
import { db, getDailyStats, bumpDailyStats, getProgress, setProgress } from './db.js';
import { onCorrect, onWrong } from './srs.js';
import { signIn, signUp, signOut, getCurrentUser, isLoggedIn } from './auth.js';
import { syncNow, lastSync } from './sync.js';
import { speak as ttsSpeak, stop as ttsStop, isPlaying as ttsPlaying, getConfig, saveConfig } from './tts.js';

const TODAY = () => new Date().toISOString().slice(0, 10);
const TOMORROW = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(c));
  }
  return e;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

// === TTS button helper ===
function ttsBtn(text, size = '16px') {
  return el('button', {
    class: 'tts-btn',
    title: 'Listen',
    style: `font-size:${size};padding:2px 6px;background:none;border:none;cursor:pointer;border-radius:4px`,
    onclick: (e) => { e.stopPropagation(); ttsSpeak(text); }
  }, '🔊');
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// === AUTH (always shows sign-in — config is hardcoded) ===
export function renderAuth() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const root = el('div', { id: 'auth-screen' });
  root.append(el('h1', {}, '📖 Phrase Learner'),
    el('p', { class: 'muted small center' }, 'Sign in to sync progress across devices'));
  const email = el('input', { type: 'email', placeholder: 'Email', autocomplete: 'email' });
  const pass = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const signInBtn = el('button', { class: 'primary', onclick: async () => {
    try { await signIn(email.value, pass.value); window.app.goto('dashboard'); }
    catch (e) { toast('Sign-in failed: ' + e.message); }
  }}, 'Sign In');
  const signUpBtn = el('button', { onclick: async () => {
    try { await signUp(email.value, pass.value); window.app.goto('dashboard'); }
    catch (e) { toast('Sign-up failed: ' + e.message); }
  }}, 'Sign Up');
  const off = el('button', { class: 'ghost', onclick: () => window.app.goto('dashboard') }, 'Continue Offline');
  root.append(
    el('div', { id: 'auth-form' }, email, pass,
      el('div', { class: 'row' }, signInBtn, signUpBtn),
      el('div', { class: 'row center' }, off))
  );
  view.append(root);
}

// === DASHBOARD (fixed stats from progress table) ===
export async function renderDashboard() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const total = await db.phrases.count();

  // Derive real counts from progress table
  const progressAll = await db.progress.toArray();
  const known = progressAll.filter((p) => p.learnStateInt === 2).length;
  const learning = progressAll.filter((p) => p.learnStateInt === 1).length;
  const pct = total ? Math.round((known / total) * 100) : 0;

  const today = TODAY();
  const stats = await getDailyStats(today);

  // Due for review: nextReview ≤ today
  const dueCount = await db.progress.where('nextReview').belowOrEqual(today).count();
  // New (never touched): phrases with no progress row AND no known/learning flag
  const touchedIds = new Set(progressAll.map((p) => p.phraseId));
  const untouched = total - touchedIds.size;

  // Streak
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const s = await getDailyStats(k);
    if (s.reviewed > 0) streak++;
    else if (i > 0) break;
  }

  view.append(
    el('div', { class: 'card' },
      el('h2', {}, 'Progress'),
      el('p', { class: 'muted small' }, `Total: ${total.toLocaleString()} phrases`),
      el('div', { class: 'progress-bar' }, el('div', { style: `width:${pct}%` })),
      el('p', { class: 'muted small' }, `Known: ${known}  Learning: ${learning}  New: ${untouched}`)
    ),
    el('div', { class: 'card' },
      el('div', { class: 'row between' },
        el('span', {}, `🔥 ${streak}-day streak`),
        el('span', {}, `⭐ ${stats.points} today`)
      )
    ),
    el('div', { class: 'card' },
      el('h3', {}, "Today's Review Queue"),
      el('p', { class: 'muted small' }, dueCount > 0
        ? `${dueCount} phrases due for review today`
        : 'No reviews due — check back tomorrow!'),
      el('button', { class: dueCount > 0 ? 'primary' : '', onclick: () => window.app.goto('revise'), style: 'width:100%;margin-top:8px' },
        dueCount > 0 ? `▶ Review ${dueCount} phrases` : 'Nothing due — 🎉')
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Learning Progress'),
      el('p', { class: 'muted small' }, `${untouched} phrases remaining to discover`),
      el('button', { onclick: () => window.app.goto('browse'), style: 'width:100%;margin-top:4px' }, '🔍 Browse & learn new phrases')
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Sync'),
      el('div', { id: 'sync-status' }, syncStatusText())
    )
  );
}

function syncStatusText() {
  return 'Supabase sync enabled ✓';
}

// === REVISE (replaces study/quiz — simple recall review) ===
let _revSession = null;

export async function renderRevise() {
  const view = document.getElementById('view');
  view.innerHTML = '';

  const today = TODAY();

  async function loadQueue() {
    const due = await db.progress
      .where('nextReview')
      .belowOrEqual(today)
      .toArray();
    // Fetch full phrase data for each
    const items = [];
    for (const d of due) {
      const phrase = await db.phrases.get(d.phraseId);
      if (phrase) items.push({ progress: d, phrase });
    }
    // Random order
    items.sort(() => Math.random() - 0.5);
    return items;
  }

  if (!_revSession) {
    const items = await loadQueue();
    if (!items.length) {
      view.append(el('div', { class: 'card center' },
        el('h2', {}, 'Nothing to review! 🎉'),
        el('p', { class: 'muted' }, 'All caught up. Go learn new phrases in Browse →'),
        el('button', { class: 'primary', onclick: () => window.app.goto('browse') }, '🔍 Browse phrases')
      ));
      return;
    }
    _revSession = { items, idx: 0, stats: { points: 0, correct: 0, wrong: 0 } };
  }

  const s = _revSession;

  if (s.idx >= s.items.length) {
    await bumpDailyStats(today, {
      points: s.stats.points, reviewed: s.stats.correct + s.stats.wrong,
      correct: s.stats.correct, wrong: s.stats.wrong
    });
    if (isLoggedIn()) syncNow().catch(() => {});
    view.append(
      el('div', { class: 'card center' },
        el('h2', {}, 'Review complete 🎉'),
        el('p', {}, `Reviewed: ${s.stats.correct + s.stats.wrong}  ·  Remembered: ${s.stats.correct}  ·  Forgot: ${s.stats.wrong}`),
        el('p', { class: 'muted' }, `+${s.stats.points} points`),
        el('button', { class: 'primary', onclick: () => { _revSession = null; window.app.goto('dashboard'); } }, 'Back to Dashboard')
      )
    );
    return;
  }

  const { phrase, progress } = s.items[s.idx];
  let answered = false;

  const card = el('div', { class: 'card', style: 'text-align:center;padding:24px 16px' });
  card.append(
    el('div', { class: 'row between' },
      el('button', { class: 'ghost', onclick: () => { _revSession = null; window.app.goto('dashboard'); } }, '← Exit'),
      el('span', { class: 'muted small' }, `${s.idx + 1}/${s.items.length}`)
    ),
    el('div', { style: 'font-size:26px;font-weight:700;margin:24px 0' }, phrase.text),
    el('button', { class: 'ghost small', onclick: () => ttsSpeak(phrase.text) }, '🔊 Hear it')
  );

  const actions = el('div', { style: 'display:flex;gap:12px;margin:20px 0;justify-content:center' });
  const remBtn = el('button', { class: 'primary', style: 'flex:1;font-size:18px;padding:16px' }, '✓ I Remember');
  const forgotBtn = el('button', { style: 'flex:1;font-size:18px;padding:16px' }, '✗ I Don\'t');

  const feedback = el('div', { id: 'quiz-feedback', class: 'hidden' });

  remBtn.onclick = async () => {
    if (answered) return; answered = true;
    onCorrect(progress);
    await setProgress(progress);
    s.stats.correct++;
    s.stats.points += 3;
    showFeedback(true, phrase);
  };
  forgotBtn.onclick = async () => {
    if (answered) return; answered = true;
    onWrong(progress);
    await setProgress(progress);
    s.stats.wrong++;
    showFeedback(false, phrase);
  };

  function showFeedback(correct, ph) {
    feedback.classList.remove('hidden');
    feedback.innerHTML = '';
    feedback.append(
      el('div', { style: correct ? 'color:#10b981;font-weight:600' : 'color:#ef4444;font-weight:600' },
        correct ? '✅ Remembered! +3 points' : '❌ Let\'s review'),
      el('div', { class: 'row', style: 'margin-top:8px;gap:4px;align-items:flex-start' },
        el('div', { class: 'muted small' }, `"${ph.text}" = ${ph.meaning}`),
        ttsBtn(`"${ph.text}". ${ph.meaning}`, '13px')
      ),
      ph.example ? el('div', { class: 'row', style: 'margin-top:4px;gap:4px;align-items:flex-start' },
        el('div', { class: 'muted small', style: 'font-style:italic' }, `• ${ph.example}`),
        ttsBtn(ph.example, '13px')
      ) : null
    );
    const nextBtn = el('button', { class: 'primary', style: 'margin-top:12px;width:100%' }, '▶ Next');
    nextBtn.onclick = () => { s.idx++; renderRevise(); };
    feedback.append(nextBtn);
  }

  actions.append(remBtn, forgotBtn);
  card.append(actions, feedback);
  view.append(card);
}

// === BROWSE (search + I Know / Learn buttons) ===
let _browseQuery = '';
let _browseLevel = '';

export async function renderBrowse() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const search = el('input', { type: 'search', placeholder: 'Search phrases by text or meaning…', value: _browseQuery });
  const levelFilter = el('select', {},
    el('option', { value: '' }, 'All levels'),
    ...['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => el('option', { value: l }, l))
  );
  levelFilter.value = _browseLevel;
  const list = el('div', { id: 'browse-list' });

  async function refresh() {
    list.innerHTML = '';
    const q = (search.value || '').toLowerCase().trim();
    const lv = levelFilter.value;
    // Persist so re-entering browse keeps the same filter
    _browseQuery = search.value;
    _browseLevel = levelFilter.value;
    let items = await db.phrases.toArray();
    if (lv) items = items.filter((x) => x.level === lv);
    if (q) items = items.filter((x) =>
      x.text.toLowerCase().includes(q) || x.meaning.toLowerCase().includes(q));
    items = items.slice(0, 100);

    // Load progress for all shown phrases
    const progressMap = {};
    for (const p of items) {
      progressMap[p.wordId] = await getProgress(p.wordId);
    }

    for (const p of items) {
      const prog = progressMap[p.wordId];
      const state = prog.learnStateInt === 0 ? 'new' : prog.learnStateInt === 1 ? 'learning' : 'known';
      list.append(renderPhraseActionRow(p, state, prog));
    }
  }

  search.addEventListener('input', debounce(refresh, 200));
  levelFilter.addEventListener('change', refresh);
  refresh();

  view.append(
    el('div', { class: 'card' },
      el('div', { class: 'col' },
        el('div', { class: 'row' }, search, levelFilter),
        el('p', { class: 'muted small center', style: 'margin:0' }, 'Hover/tap a phrase → I Know ✓ or Learn +')
      )
    ),
    list
  );
}

function renderPhraseActionRow(p, state, prog) {
  const stateTag = el('span', { class: 'tag ' + state }, state);

  const knowBtn = el('button', {
    class: 'ghost',
    style: 'font-size:13px;padding:6px 12px;white-space:nowrap',
    onclick: async () => {
      const pr = prog;
      pr.learnStateInt = 2;
      pr.rememberCount = 99;
      pr.nextReview = null;
      pr.updated_at = new Date().toISOString();
      await setProgress(pr);
      await db.phrases.update(p.wordId, { learnStateInt: 2 });
      toast(`✓ "${p.text}" marked as known`);
      renderBrowse(); // re-render
    }
  }, 'I Know ✓');

  const learnBtn = el('button', {
    class: 'primary',
    style: 'font-size:13px;padding:6px 12px;white-space:nowrap',
    onclick: () => renderLearnDetail(p)
  }, 'Learn +');

  const btnRow = el('div', { class: 'row', style: 'margin-top:6px;gap:6px' });

  if (state === 'known') {
    btnRow.append(
      el('span', { class: 'muted small' }, '✅ Mastered'),
      el('button', {
        class: 'ghost',
        style: 'font-size:12px;padding:4px 8px;white-space:nowrap;color:var(--warn)',
        onclick: async () => {
          const pr = prog;
          pr.learnStateInt = 1;
          pr.rememberCount = 0;
          pr.nextReview = TOMORROW();
          pr.masteryScore = 60;
          pr.updated_at = new Date().toISOString();
          await setProgress(pr);
          await db.phrases.update(p.wordId, { learnStateInt: 1 });
          toast(`🔄 "${p.text}" moved back to learning`);
          renderBrowse();
        }
      }, '↩ Relearn')
    );
  } else {
    btnRow.append(knowBtn, learnBtn);
  }

  return el('div', { class: 'phrase-row' },
    el('div', { class: 'row between' },
      el('span', { class: 'tag ' + p.level }, p.level),
      stateTag
    ),
    el('div', { class: 'row', style: 'gap:4px;align-items:center' },
      el('span', { class: 'text', style: 'font-size:16px' }, p.text),
      ttsBtn(p.text)
    ),
    el('div', { class: 'row', style: 'gap:4px;align-items:flex-start' },
      el('span', { class: 'meaning' }, p.meaning),
      ttsBtn(p.meaning, '14px')
    ),
    btnRow
  );
}

// === LEARN DETAIL (shown when "Learn +" is tapped) ===
function renderLearnDetail(phrase) {
  const view = document.getElementById('view');
  view.innerHTML = '';

  const card = el('div', { class: 'card', style: 'padding:32px 20px;text-align:center' });

  // Back
  card.append(
    el('button', { class: 'ghost', onclick: () => renderBrowse(), style: 'align-self:flex-start;display:block;margin-bottom:12px;text-align:left' },
      '← Back to Browse')
  );

  // Phrase (big)
  card.append(
    el('div', { style: 'font-size:28px;font-weight:700;margin:16px 0 8px' }, phrase.text)
  );

  // Audio button
  const audioBtn = el('button', {
    class: 'audio-btn',
    onclick: () => ttsSpeak(phrase.text),
    style: 'font-size:28px;width:56px;height:56px;border-radius:50%;margin:8px auto'
  }, '🔊');
  card.append(audioBtn);

  // Auto-play on mount
  setTimeout(() => ttsSpeak(phrase.text), 300);

  // Level + Score
  card.append(
    el('div', { class: 'row', style: 'justify-content:center;gap:8px;margin:12px 0' },
      el('span', { class: 'tag ' + phrase.level }, phrase.level),
      el('span', { class: 'muted small' }, phrase.type || 'phrase')
    )
  );

  // Meaning
  card.append(
    el('div', { style: 'margin:20px 0;text-align:left' },
      el('div', { class: 'muted small', style: 'margin-bottom:4px' }, 'MEANING'),
      el('div', { class: 'row', style: 'gap:4px;align-items:flex-start' },
        el('div', { style: 'font-size:17px;font-weight:500' }, phrase.meaning),
        ttsBtn(phrase.meaning, '14px')
      )
    )
  );

  // Example
  if (phrase.example) {
    card.append(
      el('div', { style: 'margin:12px 0;text-align:left' },
        el('div', { class: 'muted small', style: 'margin-bottom:4px' }, 'EXAMPLE'),
        el('div', { class: 'row', style: 'gap:4px;align-items:flex-start' },
          el('div', { style: 'font-style:italic;color:#d1d5db;flex:1' }, `"${phrase.example}"`),
          ttsBtn(phrase.example, '14px')
        )
      )
    );
  }

  // Variants
  if (phrase.otherForms) {
    const variantsText = phrase.otherForms.split(',').join(' · ');
    card.append(
      el('div', { style: 'margin:12px 0;text-align:left' },
        el('div', { class: 'muted small', style: 'margin-bottom:4px' }, 'ALSO SAID AS'),
        el('div', { class: 'row', style: 'gap:4px;align-items:flex-start' },
          el('div', { style: 'flex:1' }, variantsText),
          ttsBtn(variantsText, '14px')
        )
      )
    );
  }

  // "I've Learned This" button
  const learnedBtn = el('button', {
    class: 'primary',
    style: 'width:100%;font-size:18px;padding:16px;margin-top:24px',
    onclick: async () => {
      // Create progress: schedule for TOMORROW (review system starting next day)
      let prog = await getProgress(phrase.wordId);
      prog.learnStateInt = 1;
      prog.rememberCount = 0;
      prog.nextReview = TOMORROW();
      prog.lastReviewed = TODAY();
      prog.masteryScore = 60;
      prog.updated_at = new Date().toISOString();
      await setProgress(prog);
      await db.phrases.update(phrase.wordId, { learnStateInt: 1 });

      // Stats
      await bumpDailyStats(TODAY(), { newLearned: 1, points: 1 });

      toast(`✅ "${phrase.text}" added — review starts tomorrow`);
      renderBrowse();
    }
  }, '✅ I\'ve Learned This');

  card.append(learnedBtn);

  // Extra info
  card.append(
    el('div', { class: 'muted small', style: 'margin-top:12px' },
      'This phrase will enter your review queue starting tomorrow.')
  );

  view.append(card);
}

// === PROGRESS / STATS (unchanged) ===
export async function renderProgress() {
  const view = document.getElementById('view');
  view.innerHTML = '';

  // Streak calendar (last 28 days)
  const cal = el('div', { class: 'card' },
    el('h3', {}, 'Streak (last 28 days)'),
    el('div', { id: 'calendar' })
  );
  const calDiv = cal.querySelector('#calendar');
  const days = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const k = d.toISOString().slice(0, 10);
    const s = await getDailyStats(k);
    days.push({ key: k, label: d.getDate(), reviewed: s.reviewed, isToday: i === 0 });
  }
  for (let r = 0; r < 4; r++) {
    const row = el('div', { class: 'week-row' });
    for (let c = 0; c < 7; c++) {
      const day = days[r * 7 + c];
      row.append(el('div', {
        class: 'day-cell' + (day.reviewed ? ' studied' : '') + (day.isToday ? ' today' : '')
      }, day.label));
    }
    calDiv.append(row);
  }
  view.append(cal);

  // Mastery by level (read from progress table, not phrase table)
  const progressAll = await db.progress.toArray();
  const total = await db.phrases.count();
  const knownProgress = progressAll.filter((p) => p.learnStateInt === 2).length;
  const learningProgress = progressAll.filter((p) => p.learnStateInt === 1).length;
  const pct = total ? Math.round((knownProgress / total) * 100) : 0;

  view.append(el('div', { class: 'card' },
    el('h3', {}, 'Mastery'),
    el('div', { class: 'progress-bar' }, el('div', { style: `width:${pct}%` })),
    el('p', { class: 'muted small' },
      `Known: ${knownProgress}  Learning: ${learningProgress}  Total: ${total.toLocaleString()}`)
  ));

  // Sync controls
  view.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Sync'),
      el('div', { id: 'sync-status' }, syncStatusText()),
      el('div', { class: 'row', style: 'margin-top:8px' },
        el('button', { onclick: async () => {
          if (!isLoggedIn()) { toast('Sign in to sync'); return; }
          toast('Syncing…');
          const r = await syncNow();
          if (r.ok) toast(`Synced ✓ (${r.pushed} pushed, ${r.pulled} pulled)`);
          else toast('Sync failed: ' + (r.reason || 'unknown'));
          renderProgress();
        } }, 'Sync Now')
      )
    )
  );
}

// === SETTINGS ===
export async function renderSettings() {
  const view = document.getElementById('view');
  view.innerHTML = '';
  const user = await getCurrentUser();
  const ttsCfg = getConfig();

  view.append(
    el('div', { class: 'card' },
      el('h3', {}, 'Account'),
      user
        ? el('div', {},
            el('p', {}, user.email),
            el('button', { class: 'danger', onclick: async () => { await signOut(); window.app.goto('auth'); } }, 'Sign Out')
          )
        : el('div', {},
            el('p', { class: 'muted' }, 'Not signed in (offline mode)'),
            el('button', { class: 'primary', onclick: () => window.app.goto('auth') }, 'Sign In / Sign Up')
          )
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Supabase'),
      el('p', { class: 'muted small' }, 'Hardcoded — cloud sync enabled')
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Text-to-Speech'),
      el('div', { class: 'col', style: 'gap:10px' },
        // Provider mode selector
        el('label', { class: 'muted small' }, 'Provider mode'),
        (() => {
          const sel = el('select', { style: 'width:100%' },
            el('option', { value: 'fallback' }, 'Cartesia → Speechify (fallback)'),
            el('option', { value: 'cartesia' }, 'Cartesia only'),
            el('option', { value: 'speechify' }, 'Speechify only')
          );
          sel.value = ttsCfg.mode;
          return sel;
        })(),
        // Cartesia key
        el('label', { class: 'muted small' }, 'Cartesia API key'),
        (() => {
          const inp = el('input', { type: 'password', placeholder: 'sk_car_...', value: ttsCfg.cartesiaKey || '' });
          return inp;
        })(),
        // Speechify key
        el('label', { class: 'muted small' }, 'Speechify API key'),
        (() => {
          const inp = el('input', { type: 'password', placeholder: 'sk_...', value: ttsCfg.speechifyKey || '' });
          return inp;
        })(),
        // Save button
        el('button', { class: 'primary', style: 'width:100%;margin-top:4px', onclick: () => {
          // Gather values
          const card = view.querySelector('.card:nth-child(3)');
          const inputs = card.querySelectorAll('input[type=password]');
          const select = card.querySelector('select');
          const newCfg = {
            mode: select.value,
            cartesiaKey: inputs[0].value || '',
            cartesiaVoice: ttsCfg.cartesiaVoice,
            speechifyKey: inputs[1].value || '',
            speechifyVoice: ttsCfg.speechifyVoice
          };
          saveConfig(newCfg);
          // Clear cache so next TTS uses new keys
          toast('TTS settings saved');
        } }, 'Save TTS settings')
      )
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'Data'),
      el('button', { class: 'danger', onclick: async () => {
        if (confirm('This deletes ALL local progress and reloads. Continue?')) {
          localStorage.clear();
          indexedDB.deleteDatabase('PhraseLearnerDB');
          location.reload();
        }
      } }, 'Reset all local data')
    ),
    el('div', { class: 'card' },
      el('h3', {}, 'About'),
      el('p', { class: 'muted small' }, 'Phrase Learner v0.3 · Browse → Learn → Revise · 8,196 phrases bundled')
    )
  );
}
