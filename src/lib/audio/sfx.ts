/**
 * Built-in sound effects and music beds for `<Audio sfx="…">` (docs/AUDIO.md).
 * Each one is synthesized by ffmpeg from a formula (aevalsrc), so the sounds
 * are original, deterministic (the noise is seeded) and need no files in the
 * repository. The server renders them to WAV on first use
 * (src/lib/server/audio.ts); the parser reads `duration` to draw the clip.
 *
 * `filter` is an ffmpeg -filter_complex graph whose output pad is [out].
 * Expressions are single-quoted for the filtergraph parser (no shell involved).
 */

export interface SfxRecipe {
  label: string;
  /** what it is for, shown in the editor and to Claude */
  use: string;
  /** seconds */
  duration: number;
  /** a bed meant to repeat (`loop`) under a whole scene */
  loop?: boolean;
  filter: string;
}

const RATE = 44100;

/** One mono source from an expression of t, then optional filters. */
function synth(expr: string, duration: number, filters: string[] = []): string {
  return [`aevalsrc=exprs='${expr}':s=${RATE}:d=${duration}`, ...filters].join(",") + "[out]";
}

/** A bed: kick on the beat and a hat on the off-beat, four beats long (loops seamlessly). */
function beat(bpm: number): { duration: number; filter: string } {
  const step = 60 / bpm;
  const duration = Number((step * 4).toFixed(4));
  const kick = `sin(2*PI*(52*mod(t,${step})+90*(1-exp(-30*mod(t,${step})))/30))*exp(-9*mod(t,${step}))*0.9`;
  const hat = `(random(0)*2-1)*exp(-70*mod(t+${step / 2},${step}))*0.35`;
  return {
    duration,
    filter:
      `aevalsrc=exprs='${kick}':s=${RATE}:d=${duration}[k];` +
      `aevalsrc=exprs='${hat}':s=${RATE}:d=${duration},highpass=f=6000[h];` +
      `[k][h]amix=inputs=2:normalize=0,alimiter=limit=0.9[out]`,
  };
}

const beat90 = beat(90);
const beat120 = beat(120);

export const SFX: Record<string, SfxRecipe> = {
  whoosh: {
    label: "Whoosh",
    use: "something sweeps across the frame",
    duration: 0.8,
    filter: synth("(random(0)*2-1)*pow(sin(PI*t/0.8),2)", 0.8, ["highpass=f=300", "lowpass=f=2600", "volume=1.6"]),
  },
  swoosh: {
    label: "Swoosh",
    use: "a quick swipe or transition",
    duration: 0.4,
    filter: synth("(random(0)*2-1)*pow(sin(PI*t/0.4),3)", 0.4, ["highpass=f=900", "lowpass=f=7000", "volume=1.3"]),
  },
  pop: {
    label: "Pop",
    use: "an element pops in",
    duration: 0.2,
    filter: synth("sin(2*PI*(520*t-1300*t*t))*exp(-24*t)*0.9", 0.2),
  },
  click: {
    label: "Click",
    use: "a button press or cursor click",
    duration: 0.05,
    filter: synth("(random(0)*2-1)*exp(-260*t)*0.9", 0.05, ["highpass=f=2000"]),
  },
  tick: {
    label: "Tick",
    use: "a counter or clock step",
    duration: 0.06,
    filter: synth("sin(2*PI*2200*t)*exp(-90*t)*0.7", 0.06),
  },
  typing: {
    label: "Typing",
    use: "text typing on (1.5 s of key taps)",
    duration: 1.5,
    filter: synth("(random(0)*2-1)*exp(-170*mod(t,0.11))*0.7", 1.5, ["highpass=f=1200"]),
  },
  ding: {
    label: "Ding",
    use: "a highlight, a reveal, a correct answer",
    duration: 1.6,
    filter: synth("(sin(2*PI*1318.5*t)+0.5*sin(2*PI*2637*t)+0.25*sin(2*PI*3955.5*t))*exp(-3*t)*0.45", 1.6),
  },
  chime: {
    label: "Chime",
    use: "a soft two-note sparkle for a logo or title",
    duration: 1.4,
    filter: synth("(sin(2*PI*1318.5*t)*exp(-4*t)+gte(t,0.12)*sin(2*PI*1975.5*(t-0.12))*exp(-4*(t-0.12)))*0.42", 1.4),
  },
  success: {
    label: "Success",
    use: "a rising three-note arpeggio for a win or a call to action",
    duration: 0.9,
    filter: synth(
      "(sin(2*PI*523.25*t)*exp(-6*t)+gte(t,0.1)*sin(2*PI*659.25*(t-0.1))*exp(-6*(t-0.1))+gte(t,0.2)*sin(2*PI*783.99*(t-0.2))*exp(-5*(t-0.2)))*0.38",
      0.9,
    ),
  },
  notification: {
    label: "Notification",
    use: "a message or alert appears",
    duration: 0.7,
    filter: synth("(lt(t,0.15)*sin(2*PI*880*t)+gte(t,0.15)*sin(2*PI*1318.5*t))*exp(-4*t)*0.5", 0.7),
  },
  sparkle: {
    label: "Sparkle",
    use: "shine, magic, a glint",
    duration: 1,
    filter: synth("sin(2*PI*(2600*t+130*sin(2*PI*7*t)))*exp(-3*t)*0.32", 1),
  },
  impact: {
    label: "Impact",
    use: "a heavy hit when a title or logo lands",
    duration: 1.4,
    filter: synth("sin(2*PI*(62*t-14*t*t))*exp(-3.5*t)*0.9+(random(0)*2-1)*exp(-30*t)*0.35", 1.4, ["lowpass=f=1200"]),
  },
  "bass-hit": {
    label: "Bass hit",
    use: "a deep thump on a cut",
    duration: 0.8,
    filter: synth("sin(2*PI*45*t)*exp(-5*t)*0.95", 0.8),
  },
  riser: {
    label: "Riser",
    use: "tension building into a reveal (2 s)",
    duration: 2,
    filter: synth("(0.5*sin(2*PI*(200*t+350*t*t))+0.35*(random(0)*2-1))*(t/2)", 2, ["highpass=f=150", "volume=1.3"]),
  },
  drop: {
    label: "Drop",
    use: "a falling sweep after a reveal",
    duration: 1.2,
    filter: synth("sin(2*PI*(900*t-325*t*t))*exp(-1.2*t)*0.6", 1.2),
  },
  glitch: {
    label: "Glitch",
    use: "a digital stutter or error",
    duration: 0.5,
    filter: synth("(random(0)*2-1)*gt(sin(2*PI*14*t),0.3)*0.6+0.3*sgn(sin(2*PI*180*t))*gt(sin(2*PI*9*t),0)", 0.5),
  },
  heartbeat: {
    label: "Heartbeat",
    use: "suspense, health, life",
    duration: 1.2,
    filter: synth("(sin(2*PI*55*t)*exp(-14*t)+gte(t,0.28)*sin(2*PI*50*(t-0.28))*exp(-14*(t-0.28)))*0.9", 1.2, ["lowpass=f=300"]),
  },
  shutter: {
    label: "Camera shutter",
    use: "a photo is taken",
    duration: 0.3,
    filter: synth("(random(0)*2-1)*(exp(-120*t)+gte(t,0.09)*exp(-120*(t-0.09)))*0.6", 0.3, ["highpass=f=1500"]),
  },
  "beat-90": {
    label: "Beat 90 BPM",
    use: "a calm loop of kick and hat (loop it under the scene)",
    duration: beat90.duration,
    loop: true,
    filter: beat90.filter,
  },
  "beat-120": {
    label: "Beat 120 BPM",
    use: "an upbeat loop of kick and hat (loop it under the scene)",
    duration: beat120.duration,
    loop: true,
    filter: beat120.filter,
  },
  pad: {
    label: "Ambient pad",
    use: "a soft warm chord bed (8 s, loop it under the scene)",
    duration: 8,
    loop: true,
    filter: synth(
      "(sin(2*PI*220*t)+sin(2*PI*277.125*t)+sin(2*PI*329.625*t)+0.5*sin(2*PI*440*t))*(0.65+0.35*sin(2*PI*0.25*t))*0.16",
      8,
      ["lowpass=f=1800"],
    ),
  },
};

export const SFX_NAMES = Object.keys(SFX);

export function isSfxName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(SFX, name);
}

/** Length in seconds of a built-in sound, or undefined for unknown names. */
export function sfxDuration(name: string): number | undefined {
  return isSfxName(name) ? SFX[name].duration : undefined;
}
