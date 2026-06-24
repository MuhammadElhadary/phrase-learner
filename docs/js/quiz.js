// quiz.js — Quiz generation for the 7 quiz types
import { db, getProgress, setProgress } from './db.js';
import { onCorrect, onWrong } from './srs.js';

const TYPES = [
  'PhrasePickDefinition',
  'DefinitionPickPhrase',
  'BlankExampleConfirm',
  'ExampleConfirmRemembering',
  'DefinitionPickSpelling',
  'AudioPickDefinition',
  'AudioPickSpelling'
];

function pickN(arr, n, excludeId) {
  const pool = arr.filter((x) => x.wordId !== excludeId);
  const out = [];
  while (out.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Build a single quiz for a target phrase
export async function buildQuiz(target, typeOverride) {
  const type = typeOverride || TYPES[Math.floor(Math.random() * TYPES.length)];
  const all = await db.phrases.toArray();
  const distractors = pickN(all, 3, target.wordId);

  let prompt, options = [], correctIndex = 0, extra = {};

  switch (type) {
    case 'PhrasePickDefinition': {
      prompt = target.text;
      const meanings = shuffle([target.meaning, ...distractors.map((d) => d.meaning)]);
      options = meanings;
      correctIndex = meanings.indexOf(target.meaning);
      extra = { ttsText: target.text };
      break;
    }
    case 'DefinitionPickPhrase': {
      prompt = target.meaning;
      const phrases = shuffle([target.text, ...distractors.map((d) => d.text)]);
      options = phrases;
      correctIndex = phrases.indexOf(target.text);
      break;
    }
    case 'BlankExampleConfirm': {
      // Hide the phrase in its example with "___"
      const ex = (target.example || `${target.text} is an English phrase.`).replace(
        new RegExp(escapeRegex(target.text), 'i'),
        '___'
      );
      const choices = shuffle([target.text, ...distractors.map((d) => d.text)]);
      prompt = ex;
      options = choices;
      correctIndex = choices.indexOf(target.text);
      break;
    }
    case 'ExampleConfirmRemembering': {
      const ex = target.example || `${target.text}: ${target.meaning}`;
      options = ['I Remember ✓', 'Look Up 🔍'];
      correctIndex = 0;
      prompt = ex;
      break;
    }
    case 'DefinitionPickSpelling': {
      prompt = target.meaning;
      const misspellings = (target.misspellings && target.misspellings.length >= 3)
        ? target.misspellings.slice(0, 3)
        : synthesizeMisspellings(target.text);
      const opts = shuffle([target.text, ...misspellings]);
      options = opts;
      correctIndex = opts.indexOf(target.text);
      break;
    }
    case 'AudioPickDefinition': {
      prompt = '🔊 Listen and pick the meaning';
      const meanings = shuffle([target.meaning, ...distractors.map((d) => d.meaning)]);
      options = meanings;
      correctIndex = meanings.indexOf(target.meaning);
      extra = { autoPlay: target.text };
      break;
    }
    case 'AudioPickSpelling': {
      prompt = '🔊 Listen and pick the spelling';
      const misspellings = (target.misspellings && target.misspellings.length >= 3)
        ? target.misspellings.slice(0, 3)
        : synthesizeMisspellings(target.text);
      const opts = shuffle([target.text, ...misspellings]);
      options = opts;
      correctIndex = opts.indexOf(target.text);
      extra = { autoPlay: target.text };
      break;
    }
  }

  return { type, prompt, options, correctIndex, target, extra };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function synthesizeMisspellings(text) {
  const t = text.split('');
  if (t.length < 3) return [text, text, text];
  return [
    swapFirstVowel(text),
    doubleRandom(text),
    dropRandom(text)
  ];
}
function swapFirstVowel(s) { return s.replace(/[aeiou]/i, (m) => ({ a: 'e', e: 'i', i: 'o', o: 'u', u: 'a' }[m.toLowerCase()] || m)); }
function doubleRandom(s) { const i = Math.floor(Math.random() * s.length); return s.slice(0, i) + s[i] + s.slice(i); }
function dropRandom(s) { const i = Math.floor(Math.random() * (s.length - 1)) + 1; return s.slice(0, i) + s.slice(i + 1); }

// === Session loop ===
export class StudySession {
  constructor(queue) { this.queue = queue; this.idx = 0; this.stats = { points: 0, correct: 0, wrong: 0, reviewed: 0, newLearned: 0 }; }

  current() { return this.queue[this.idx]; }
  hasNext() { return this.idx < this.queue.length; }

  async answer(correct) {
    const target = this.current();
    if (!target) return;
    const p = await getProgress(target.wordId);
    const wasNew = p.learnStateInt === 0;
    if (correct) {
      onCorrect(p);
      this.stats.correct++;
      this.stats.points += 3;
      if (wasNew) this.stats.newLearned++;
    } else {
      onWrong(p);
      this.stats.wrong++;
    }
    this.stats.reviewed++;
    await setProgress(p);
    target.learnStateInt = p.learnStateInt;
    this.idx++;
    return p;
  }
}
