// Kitchen timers. Kept outside any component so they keep running while you
// move between steps, back to the recipe, and into cook mode again.
// They hold an end time, not a countdown, so a phone that sleeps for a minute
// still shows the right time when it wakes.

import { useSyncExternalStore } from "react";

export interface Timer {
  id: string;
  label: string;
  endsAt: number;
  total: number;
  done: boolean;
}

let timers: Timer[] = [];
const listeners = new Set<() => void>();
let audio: AudioContext | null = null;
let ticker: ReturnType<typeof setInterval> | undefined;

function emit() {
  timers = [...timers];
  listeners.forEach((l) => l());
}

export function useTimers(): Timer[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => timers,
  );
}

// How long a finished timer keeps sounding if nobody taps it. Long enough to
// be heard from the next room, short enough not to beep through the night if
// the phone was left on the counter.
const ALARM_MAX_MS = 3 * 60 * 1000;
const ALARM_EVERY_MS = 2500;
let alarm: ReturnType<typeof setInterval> | undefined;

/** Browsers only let a page make sound after a tap, and phones suspend the
 *  audio of a page that was in the background. Every tap re-arms it. */
function primeAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state !== "running") void audio.resume();
  } catch { /* no Web Audio: vibration and the flashing tile still work */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("pointerdown", () => { if (audio) primeAudio(); }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && audio) primeAudio(); });
}

export function startTimer(id: string, label: string, seconds: number) {
  // Inside the tap that starts the timer, which is what unlocks sound.
  primeAudio();
  chirp();
  timers = timers.filter((t) => t.id !== id);
  timers.push({ id, label, endsAt: Date.now() + seconds * 1000, total: seconds, done: false });
  emit();
  ticker ??= setInterval(check, 500);
}

export function stopTimer(id: string) {
  timers = timers.filter((t) => t.id !== id);
  emit();
  if (!timers.some(ringingNow)) stopAlarm();
  if (!timers.length && ticker) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

function ringingNow(t: Timer) {
  return t.done && Date.now() - t.endsAt < ALARM_MAX_MS;
}

function check() {
  let finished = false;
  timers = timers.map((t) => {
    if (t.done || Date.now() < t.endsAt) return t;
    finished = true;
    return { ...t, done: true };
  });
  if (finished) startAlarm();
  // A new array every tick, so subscribers re-render and countdowns move.
  emit();
}

/** Ring now, and again every few seconds until every finished timer is
 *  dismissed or has rung for ALARM_MAX_MS. */
function startAlarm() {
  ring();
  alarm ??= setInterval(() => {
    if (!timers.some(ringingNow)) return stopAlarm();
    ring();
  }, ALARM_EVERY_MS);
}

function stopAlarm() {
  if (alarm) clearInterval(alarm);
  alarm = undefined;
}

function tone(freq: number, at: number, length: number, peak: number) {
  if (!audio) return;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  // Square carries over a sizzling pan far better than a sine at the same volume.
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  gain.gain.setValueAtTime(peak, at + length - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(audio.destination);
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** The kitchen-timer pattern: two high notes, four times. */
function ring() {
  navigator.vibrate?.([250, 120, 250, 120, 250, 120, 250]);
  if (!audio) return;
  if (audio.state !== "running") void audio.resume();
  const now = audio.currentTime;
  for (let i = 0; i < 4; i++) {
    tone(1047, now + i * 0.42, 0.14, 0.32); // C6
    tone(1319, now + i * 0.42 + 0.17, 0.14, 0.32); // E6
  }
}

/** A short blip when a timer starts: proof the phone will make a sound. */
function chirp() {
  if (!audio) return;
  tone(880, audio.currentTime + 0.02, 0.07, 0.12);
}
