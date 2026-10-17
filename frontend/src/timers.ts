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

export function startTimer(id: string, label: string, seconds: number) {
  // Created inside the tap that starts the timer: browsers only allow sound
  // from an AudioContext that a user gesture unlocked.
  try {
    audio ??= new AudioContext();
    void audio.resume();
  } catch { /* no sound, still vibrates and flashes */ }
  timers = timers.filter((t) => t.id !== id);
  timers.push({ id, label, endsAt: Date.now() + seconds * 1000, total: seconds, done: false });
  emit();
  ticker ??= setInterval(check, 500);
}

export function stopTimer(id: string) {
  timers = timers.filter((t) => t.id !== id);
  emit();
  if (!timers.length && ticker) {
    clearInterval(ticker);
    ticker = undefined;
  }
}

function check() {
  timers = timers.map((t) => {
    if (t.done || Date.now() < t.endsAt) return t;
    ring();
    return { ...t, done: true };
  });
  // A new array every tick, so subscribers re-render and countdowns move.
  emit();
}

function ring() {
  navigator.vibrate?.([300, 150, 300, 150, 600]);
  if (!audio) return;
  const now = audio.currentTime;
  [0, 0.35, 0.7].forEach((offset) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, now + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3);
    osc.connect(gain).connect(audio!.destination);
    osc.start(now + offset);
    osc.stop(now + offset + 0.32);
  });
}
