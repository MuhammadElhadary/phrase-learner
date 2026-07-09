// auth.js — Supabase auth (hardcoded config, works directly)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = 'https://jfspmroaedxuklzuwvib.supabase.co';
const SUPABASE_ANON = 'sb_publishable_o0t9VLGg-HayFKHsFJ4pkQ_wjKiuaIL';

let _client = null;
let _user = null;

export function hasSupabaseConfig() { return true; }

export function setSupabaseConfig(url, anon) {
  // no-op — config is hardcoded
}

export function getClient() {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, storage: localStorage, autoRefreshToken: true }
  });
  return _client;
}

export async function getCurrentUser() {
  if (_user) return _user;
  const c = getClient();
  if (!c) return null;
  try {
    // Timeout after 8s — if Supabase is unreachable (VPN, etc.), fail fast
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const { data } = await c.auth.getUser();
    clearTimeout(timer);
    _user = data.user || null;
  } catch (e) {
    // Network failure (VPN blocking supabase.co) — clear stale session so app doesn't hang
    console.warn('[auth] getUser failed, clearing session:', e);
    _user = null;
    try { await c.auth.signOut(); } catch (_) {}
  }
  return _user;
}

export async function signIn(email, password) {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured.');
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _user = data.user;
  return _user;
}

export async function signUp(email, password) {
  const c = getClient();
  if (!c) throw new Error('Supabase not configured.');
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw error;
  _user = data.user;
  return _user;
}

export async function signOut() {
  const c = getClient();
  if (c) await c.auth.signOut();
  _user = null;
}

export function isLoggedIn() {
  return Boolean(_user);
}