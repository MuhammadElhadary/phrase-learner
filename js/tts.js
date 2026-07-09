// tts.js — Cartesia TTS integration for Phrase Learner
const API_URL = 'https://api.cartesia.ai/tts/bytes';
const API_KEY = 'sk_car_nr98uv7pmhTNUNz7ZYmTce';
const API_VERSION = '2026-03-01';

let currentAudio = null;
let voiceId = 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4'; // Skylar - Friendly Guide (American female)
const cache = new Map();
const listeners = [];

export function setVoice(id) { voiceId = id; }

export function getVoice() { return voiceId; }

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

  // Stop current playback
  stop();
  _notify();

  // Check cache
  const cacheKey = trimmed.toLowerCase().slice(0, 120);
  if (cache.has(cacheKey)) {
    const url = cache.get(cacheKey);
    return _playUrl(url);
  }

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
        'Cartesia-Version': API_VERSION
      },
      body: JSON.stringify({
        transcript: trimmed,
        voice: { mode: 'id', id: voiceId },
        model_id: 'sonic-2',
        output_format: { container: 'wav', encoding: 'pcm_f32le', sample_rate: 24000 }
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.warn('[tts] API error:', err.message || response.statusText);
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    cache.set(cacheKey, url);

    // LRU eviction if cache grows too large
    if (cache.size > 100) {
      const first = cache.keys().next().value;
      const oldUrl = cache.get(first);
      URL.revokeObjectURL(oldUrl);
      cache.delete(first);
    }

    return _playUrl(url);
  } catch (e) {
    console.warn('[tts] network error:', e);
  }
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
