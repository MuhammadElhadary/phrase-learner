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
  document.getElementById('view').innerHTML = '<div class="card center muted">Loading phrases…</div>';

  // 2. Seed phrases (5MB, runs once — subsequent loads are instant)
  try {
    const n = await loadPhrases();
    console.log(`[boot] phrases ready: ${n}`);
  } catch (e) {
    console.error('[boot] seed failed', e);
    document.getElementById('view').innerHTML =
      `<div class="card">Failed to load phrase data: ${e.message}</div>`;
    return;
  }

  // 3. Restore auth state (if Supabase configured)
  try { await getCurrentUser(); } catch (_) {}

  // 4. Nav bindings
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.addEventListener('click', () => app.goto(b.dataset.view));
  });

  // 5. Initial route: settings if no Supabase, else dashboard
  const userArea = document.getElementById('user-area');
  if (isLoggedIn()) {
    const u = await getCurrentUser();
    userArea.innerHTML = `<span>${u.email}</span><button onclick="window.app.goto('settings')">⚙️</button>`;
  } else {
    userArea.innerHTML = `<button onclick="window.app.goto('auth')">Sign in</button>`;
  }

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
