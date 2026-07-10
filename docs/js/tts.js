// tts.js — TTS with Cartesia (primary) + Speechify (fallback), configurable via settings
const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_VER = '2026-03-01';
const SPEECHIFY_URL = 'https://api.sws.speechify.com/v1/audio/speech';

const STORAGE_KEY = 'tts_config';

const DEFAULTS = {
  mode: 'fallback', // 'cartesia' | 'speechify' | 'fallback'
  cartesiaKey: 'sk_car_nr98uv7pmhTNUNz7ZYmTce',
  cartesiaVoice: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', // Skylar
  speechifyKey: 'sk_ejwaxg0rqk2mmagn3xa527kw00s24sfy6x1h1xm27g2',
  speechifyVoice: 'victoria'
};

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (_) { /* ignore */ }
  return { ...DEFAULTS };
}

function saveConfigToLS(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function getConfig() {
  return loadConfig();
}

export function saveConfig(cfg) {
  saveConfigToLS(cfg);
}

let currentAudio = null;
const cache = new Map();
const listeners = [];

export function isPlaying() {
  return currentAudio != null && !currentAudio.paused && currentAudio.readyState >= 2;
}

export function stop() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
    _notify();
  }
}

export function onStateChange(fn) {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

function _notify() {
  const playing = isPlaying();
  listeners.forEach(fn => fn(playing));
}

export async function speak(text) {
  if (!text || !text.trim()) return;
  const trimmed = text.trim();
  stop();
  _notify();

  const cfg = loadConfig();
  const cacheKey = trimmed.toLowerCase().slice(0, 120);
  if (cache.has(cacheKey)) {
    return _playUrl(cache.get(cacheKey));
  }

  let blob = null;

  // Try Cartesia (if mode is 'cartesia' or 'fallback')
  if (cfg.mode === 'cartesia' || cfg.mode === 'fallback') {
    if (cfg.cartesiaKey && cfg.cartesiaKey.length > 10) {
      try {
        const res = await fetch(CARTESIA_URL, {
          method: 'POST',
          headers: {
            'X-API-Key': cfg.cartesiaKey,
            'Content-Type': 'application/json',
            'Cartesia-Version': CARTESIA_VER
          },
          body: JSON.stringify({
            transcript: trimmed,
            voice: { mode: 'id', id: cfg.cartesiaVoice },
            model_id: 'sonic-2',
            output_format: { container: 'wav', encoding: 'pcm_f32le', sample_rate: 24000 }
          })
        });
        if (res.ok) {
          blob = await res.blob();
        } else {
          const err = await res.json().catch(() => ({}));
          console.warn('[tts] Cartesia error:', err.message || res.status);
          if (cfg.mode === 'cartesia') return; // don't fallback if user chose cartesia only
        }
      } catch (e) {
        console.warn('[tts] Cartesia network error:', e.message);
        if (cfg.mode === 'cartesia') return;
      }
    }
  }

  // Try Speechify (if mode is 'speechify' or 'fallback' and Cartesia didn't produce blob)
  if (!blob && (cfg.mode === 'speechify' || cfg.mode === 'fallback')) {
    if (cfg.speechifyKey && cfg.speechifyKey.length > 10) {
      try {
        const res = await fetch(SPEECHIFY_URL, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + cfg.speechifyKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'simba-english',
            input: trimmed,
            voice_id: cfg.speechifyVoice
          })
        });
        if (res.ok) {
          const json = await res.json();
          const binary = atob(json.audio_data);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          blob = new Blob([bytes], { type: 'audio/wav' });
        } else {
          const err = await res.json().catch(() => ({}));
          console.warn('[tts] Speechify error:', err.message || res.status);
          return;
        }
      } catch (e) {
        console.warn('[tts] Speechify network error:', e.message);
        return;
      }
    }
  }

  if (!blob) return;

  const url = URL.createObjectURL(blob);
  cache.set(cacheKey, url);
  if (cache.size > 100) {
    const first = cache.keys().next().value;
    URL.revokeObjectURL(cache.get(first));
    cache.delete(first);
  }
  return _playUrl(url);
}

function _playUrl(url) {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    _notify();
    audio.onended = () => { currentAudio = null; _notify(); resolve(); };
    audio.onerror = () => { currentAudio = null; _notify(); resolve(); };
    audio.play().catch(() => { currentAudio = null; _notify(); resolve(); });
  });
}
