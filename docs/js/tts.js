// tts.js — TTS with Cartesia (primary) + Speechify (fallback)
const CARTESIA_URL = 'https://api.cartesia.ai/tts/bytes';
const CARTESIA_KEY = 'sk_car_nr98uv7pmhTNUNz7ZYmTce';
const CARTESIA_VER = '2026-03-01';

const SPEECHIFY_URL = 'https://api.sws.speechify.com/v1/audio/speech';
const SPEECHIFY_KEY = 'sk_ejwaxg0rqk2mmagn3xa527kw00s24sfy6x1h1xm27g2';

let currentAudio = null;
let cartesiaVoice = 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4'; // Skylar
let speechifyVoice = 'victoria'; // en-US, neutral American female
const cache = new Map();
const listeners = [];

export function setVoice(id) { cartesiaVoice = id; }
export function getVoice() { return cartesiaVoice; }
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

  // Check shared cache
  const cacheKey = trimmed.toLowerCase().slice(0, 120);
  if (cache.has(cacheKey)) {
    return _playUrl(cache.get(cacheKey));
  }

  // Try Cartesia first
  let blob = null;
  try {
    const res = await fetch(CARTESIA_URL, {
      method: 'POST',
      headers: {
        'X-API-Key': CARTESIA_KEY,
        'Content-Type': 'application/json',
        'Cartesia-Version': CARTESIA_VER
      },
      body: JSON.stringify({
        transcript: trimmed,
        voice: { mode: 'id', id: cartesiaVoice },
        model_id: 'sonic-2',
        output_format: { container: 'wav', encoding: 'pcm_f32le', sample_rate: 24000 }
      })
    });
    if (res.ok) {
      blob = await res.blob();
    } else {
      const err = await res.json().catch(() => ({}));
      console.warn('[tts] Cartesia error, falling back:', err.message || res.status);
    }
  } catch (e) {
    console.warn('[tts] Cartesia network error, falling back:', e.message);
  }

  // Fallback to Speechify if Cartesia failed
  if (!blob) {
    try {
      const res = await fetch(SPEECHIFY_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SPEECHIFY_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'simba-english',
          input: trimmed,
          voice_id: speechifyVoice
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

  // Cache and play
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
