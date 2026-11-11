// ponytail: native Web Audio API synth (~35 lines), zero MP3 assets needed
let audioCtx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (muted || typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tone(freq: number, durationMs: number, delayMs = 0, type: OscillatorType = 'sine', gainVal = 0.06) {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delayMs / 1000;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(gainVal, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + durationMs / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + durationMs / 1000);
}

export const soundEffects = {
  isMuted: () => muted,
  setMuted: (m: boolean) => {
    muted = m;
  },
  playRadioBeep: () => {
    tone(1200, 60, 0, 'sine', 0.05);
    tone(1600, 80, 65, 'sine', 0.05);
  },
  playTacticalClick: () => {
    tone(220, 18, 0, 'triangle', 0.07);
  },
  playCheckeredFlag: () => {
    tone(523.25, 90, 0, 'triangle', 0.06);
    tone(659.25, 90, 95, 'triangle', 0.06);
    tone(783.99, 160, 190, 'triangle', 0.06);
  },
};
