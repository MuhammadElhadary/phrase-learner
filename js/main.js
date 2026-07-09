// main.js — App bootstrap, view router, service worker registration
import { loadPhrases, db } from './db.js';
import { renderDashboard, renderAuth, renderRevise, renderBrowse, renderProgress, renderSettings, toast } from './views.js';
import { getCurrentUser, isLoggedIn } from './auth.js';
import { syncNow } from './sync.js';

const VIEWS = {
  dashboard: renderDashboard,
  auth:      renderAuth,
  revise:    renderRevise,
  browse:    renderBrowse,
  progress:  renderProgress,
  settings:  renderSettings
};

const app = {
  current: 'dashboard',
  goto(view) {
    if (!VIEWS[view]) return;
    this.current = view;
    // update nav
    document.querySelectorAll('.nav-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === view);
    });
    VIEWS[view]();
  }
};
window.app = app;

// === Boot ===
async function boot() {
  // 1. Show something immediately so UI feels responsive
  const viewEl = document.getElementById('view');
  viewEl.innerHTML = '<div class="card center muted">Loading phrases…</div>';

  // 2. Seed phrases (5MB, runs once — subsequent loads are instant)
  try {
    const n = await loadPhrases();
    console.log(`[boot] phrases ready: ${n}`);
  } catch (e) {
    console.error('[boot] seed failed', e);
    viewEl.innerHTML =
      `<div class="card">Failed to load phrase data: ${e.message}</div>`;
    return;
  }

  // 3. Restore auth state (non-blocking — fails fast if Supabase unreachable)
  //    The 8s timeout and error->null logic is inside getCurrentUser()
  try { await getCurrentUser(); } catch (_) { }

  // 3b. Nav bindings (must happen before goto so buttons are wired)
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => app.goto(b.dataset.view));
  });

  // 4. Show user area without blocking the boot
  const userArea = document.getElementById('user-area');
  if (isLoggedIn()) {
    const u = await getCurrentUser(); // fast now since _user is cached
    userArea.innerHTML = `<span>${u?.email || ''}</span><button onclick="window.app.goto('settings')">⚙️</button>`;
  } else {
    userArea.innerHTML = `<button onclick="window.app.goto('auth')">Sign in</button>`;
  }

  // 5. Show dashboard immediately — don't wait for auth/sync
  app.goto('dashboard');

  // 6. Background sync (best-effort, doesn't block UI)
  if (isLoggedIn()) {
    syncNow().then((r) => {
      if (r.ok) console.log(`[boot] sync ok: ${r.pushed}↑ ${r.pulled}↓`);
    }).catch(() => {});
  }
}

boot();

// Service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW register failed', e));
  });
}

// Refresh user area when auth state changes
window.addEventListener('storage', async () => {
  if (isLoggedIn()) {
    const u = await getCurrentUser();
    document.getElementById('user-area').innerHTML = `<span>${u.email}</span>`;
  }
});