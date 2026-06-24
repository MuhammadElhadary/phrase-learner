// auth.js — Supabase auth (lazy-loaded; works offline)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

let _client = null;
let _user = null;

function getSupabaseUrl() { return localStorage.getItem('sb_url') || ''; }
function getSupabaseAnon() { return localStorage.getItem('sb_anon') || ''; }

export function hasSupabaseConfig() {
  return Boolean(getSupabaseUrl() && getSupabaseAnon());
}

export function setSupabaseConfig(url, anon) {
  localStorage.setItem('sb_url', url);
  localStorage.setItem('sb_anon', anon);
  _client = null;
}

export function getClient() {
  if (_client) return _client;
  const url = getSupabaseUrl();
  const anon = getSupabaseAnon();
  if (!url || !anon) return null;
  _client = createClient(url, anon, {
    auth: { persistSession: true, storage: localStorage, autoRefreshToken: true }
  });
  return _client;
}

export async function getCurrentUser() {
  if (_user) return _user;
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getUser();
  _user = data.user || null;
  return _user;
}

export async function signIn(email, password) {
  const c = getClient();
  if (!c) throw new Error('Configure Supabase in Settings first.');
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  _user = data.user;
  return _user;
}

export async function signUp(email, password) {
  const c = getClient();
  if (!c) throw new Error('Configure Supabase in Settings first.');
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
