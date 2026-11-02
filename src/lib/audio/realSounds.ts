/**
 * Real recorded sound effects and music beds for `<Audio sound="…">` (docs/AUDIO.md): CC0
 * recordings from Freesound, picked by listening with earshot (each effect measured as a real or
 * professionally produced recording, or a designed sound of a kind that is synthetic by nature:
 * risers, glitches, drops; each bed as professionally mixed music with full bandwidth). Nothing is
 * stored in the repository: the server downloads a sound's preview on first use, trims it, levels it
 * (effects by peak, music by loudness) and caches it (src/lib/server/audio.ts).
 *
 * `peak` is where an effect hits, in seconds from its start (after the trim): start the clip that
 * long before the frame it belongs to (a whoosh's rush, an impact's boom, a riser's top).
 * `duration` is the trimmed length. Both were measured on the files, as were a bed's tempo and
 * first beat.
 */

export interface RealSound {
  /** what it is, when to use it (shown in the editor and to Claude) */
  use: string;
  duration: number;
  /** seconds from the start to the hit (0 for music) */
  peak: number;
  /** a music bed: beats fall at `firstBeat + n * 60 / bpm`; `loops`: the file repeats without a seam */
  music?: { bpm: number; firstBeat: number; loops: boolean };
  source: {
    freesoundId: number;
    title: string;
    author: string;
    /** Freesound's high-quality preview (OGG) */
    preview: string;
    /** seconds of the preview kept */
    trim: [number, number];
  };
}

const preview = (id: number, user: number) => `https://cdn.freesound.org/previews/${Math.floor(id / 1000)}/${id}_${user}-hq.ogg`;

export const REAL_SOUND_LICENSE = "CC0 1.0 (public domain), from freesound.org";

export const REAL_SOUNDS = {
  "whoosh-fast": {
    use: "fast whip-zoom whoosh that rushes in and hits at its end: start it 1.78 s before the cut it lands on",
    duration: 2.13,
    peak: 1.78,
    source: { freesoundId: 486234, title: "Whoosh For Whip Zoom", author: "BennettFilmTeacher", preview: preview(486234, 7254895), trim: [0, 2.13] },
  },
  "whoosh-soft": {
    use: "soft, deep air whoosh for a gentle slide or transition",
    duration: 2.18,
    peak: 0.36,
    source: { freesoundId: 558827, title: "Deep Whoosh #5", author: "Kinoton", preview: preview(558827, 2247456), trim: [0.37, 2.55] },
  },
  "whoosh-cinematic": {
    use: "big cinematic pass-by whoosh for a scene change or a hero reveal",
    duration: 4,
    peak: 1.51,
    source: { freesoundId: 848212, title: "Whoosh, Futuristic, Pass-By, Cinematic 03", author: "JW_Audio", preview: preview(848212, 13183432), trim: [0.05, 4.05] },
  },
  "swish-fast": {
    use: "strong, quick stick swish for a fast move or a word slamming in",
    duration: 0.77,
    peak: 0.21,
    source: { freesoundId: 614170, title: "Swishes_4_strong_fast", author: "videofueralle", preview: preview(614170, 1130120), trim: [0.45, 1.22] },
  },
  "swish-quick": {
    use: "very short air swish for small moves and word pops",
    duration: 0.28,
    peak: 0.05,
    source: { freesoundId: 683101, title: "quick woosh", author: "florianreichelt", preview: preview(683101, 6253486), trim: [0.17, 0.45] },
  },
  "swoosh-short": {
    use: "short swoosh for a card or panel sliding in",
    duration: 0.28,
    peak: 0.05,
    source: { freesoundId: 585257, title: "swoosh-1", author: "lesaucisson", preview: preview(585257, 4530936), trim: [0.12, 0.4] },
  },
  pop: {
    use: "punchy pop for an icon, sticker or bubble appearing",
    duration: 0.17,
    peak: 0.01,
    source: { freesoundId: 245646, title: "Cartoon Pop (Distorted)", author: "unfa", preview: preview(245646, 1038806), trim: [0, 0.17] },
  },
  click: {
    use: "real mouse / UI click for a button press or a cursor tap",
    duration: 0.41,
    peak: 0.02,
    source: { freesoundId: 488534, title: "UI click", author: "Ranner", preview: preview(488534, 5382295), trim: [0.19, 0.6] },
  },
  "click-soft": {
    use: "light, short button click",
    duration: 0.12,
    peak: 0.01,
    source: { freesoundId: 467951, title: "UI Button Click", author: "benzix2", preview: preview(467951, 6769414), trim: [0, 0.12] },
  },
  typing: {
    use: "2.5 s of real mechanical-keyboard typing for text typed on screen (set end for less)",
    duration: 2.5,
    peak: 0.1,
    source: { freesoundId: 685984, title: "Keyboard typing sounds: modded Omnikey 101", author: "zrrion", preview: preview(685984, 2686637), trim: [5, 7.5] },
  },
  "typing-long": {
    use: "8 s of steady keyboard typing under a longer typing shot",
    duration: 8,
    peak: 0.14,
    source: { freesoundId: 442689, title: "Keyboard Typing", author: "bwarpus99", preview: preview(442689, 9034957), trim: [0, 8] },
  },
  "impact-cinematic": {
    use: "cinematic boom with a long tail; its hit is 1.41 s in: start it 1.41 s before the reveal",
    duration: 6.2,
    peak: 1.41,
    source: { freesoundId: 719831, title: "impact_01", author: "vekoN", preview: preview(719831, 11045610), trim: [0, 6.2] },
  },
  "boom-deep": {
    use: "deep cinematic impact that hits at once and rumbles out: a logo or title reveal",
    duration: 4.9,
    peak: 0.01,
    source: { freesoundId: 754421, title: "Deep Cinematic Impact 2", author: "zazz.sound.design", preview: preview(754421, 726853), trim: [0, 4.9] },
  },
  punch: {
    use: "real punch hit for a hard text slam or a beat accent",
    duration: 0.47,
    peak: 0.08,
    source: { freesoundId: 439747, title: "Punch Hit 1", author: "joe_anderson22", preview: preview(439747, 3507073), trim: [0.13, 0.6] },
  },
  thud: {
    use: "meaty, organic thud for something landing",
    duration: 0.57,
    peak: 0.05,
    source: { freesoundId: 388038, title: "Lettuce Hit", author: "saturdaysoundguy", preview: preview(388038, 7280678), trim: [0.72, 1.29] },
  },
  riser: {
    use: "2.5 s riser that tops out at 2.2 s: end it on the drop or the reveal",
    duration: 2.48,
    peak: 2.2,
    source: { freesoundId: 685256, title: "Riser sound effect short", author: "syntheffects", preview: preview(685256, 12265588), trim: [0.57, 3.05] },
  },
  ding: {
    use: "soft bell ding-dong for a notification or a check mark",
    duration: 0.79,
    peak: 0.18,
    source: { freesoundId: 571513, title: "Soft-Notifications - Bell - Ding-Dong", author: "LegitCheese", preview: preview(571513, 2226836), trim: [0.01, 0.8] },
  },
  "camera-shutter": {
    use: "real camera shutter for a photo, a freeze frame or a flash cut",
    duration: 0.51,
    peak: 0.06,
    source: { freesoundId: 520684, title: "Contarex camera shutter", author: "Tonik1105", preview: preview(520684, 10067806), trim: [0.79, 1.3] },
  },
  glitch: {
    use: "short digital glitch for a glitch cut or a tech accent",
    duration: 0.35,
    peak: 0.07,
    source: { freesoundId: 424375, title: "glitched sound 1", author: "Elnosos", preview: preview(424375, 7099958), trim: [0, 0.35] },
  },
  sparkle: {
    use: "light magic sparkle for a shine or a highlight",
    duration: 0.9,
    peak: 0,
    source: { freesoundId: 511485, title: "cartoon_wink_magic_sparkle", author: "MLaudio", preview: preview(511485, 6890478), trim: [0, 0.9] },
  },
  "magic-transition": {
    use: "playful magic swirl into a new scene; it peaks at 0.9 s",
    duration: 2.25,
    peak: 0.9,
    source: { freesoundId: 856641, title: "Cartoon Magic Transition", author: "qubodup", preview: preview(856641, 71257), trim: [0, 2.25] },
  },
  "bass-drop": {
    use: "heavy bass drop that hits 1.6 s in: big reveals in energetic edits",
    duration: 3.2,
    peak: 1.6,
    source: { freesoundId: 727610, title: "Color Bass 1", author: "staticpony1", preview: preview(727610, 4508519), trim: [0, 3.2] },
  },
  success: {
    use: "bright success chimes for a result, a tick or the final call to action",
    duration: 0.9,
    peak: 0.29,
    source: { freesoundId: 541985, title: "GASP_Chimes_Success_4", author: "Rob_Marion", preview: preview(541985, 6856600), trim: [0, 0.9] },
  },
  tick: {
    use: "single clock tick for counters, timers or a list item appearing",
    duration: 0.2,
    peak: 0.05,
    source: { freesoundId: 534094, title: "clock-tick-01", author: "pbimal", preview: preview(534094, 11830391), trim: [0, 0.2] },
  },
  "music-corporate": {
    use: "inspiring corporate pop with echo guitar and piano: product, brand and explainer videos",
    duration: 60,
    peak: 0,
    music: { bpm: 120, firstBeat: 0.03, loops: true },
    source: { freesoundId: 713517, title: "Perspire (Loop)", author: "JapanYoshiTheGamer", preview: preview(713517, 2901280), trim: [0, 60] },
  },
  "music-playful": {
    use: "cheerful, playful ukulele-and-brass tune: light, friendly or funny videos",
    duration: 37.65,
    peak: 0,
    music: { bpm: 101.3, firstBeat: 0.31, loops: false },
    source: { freesoundId: 561190, title: "Tropicorp Advertisement", author: "code_box", preview: preview(561190, 10962806), trim: [0, 37.65] },
  },
  "music-hiphop": {
    use: "laid-back hip-hop beat with a heavy bass: lifestyle, street, talking-head and caption reels",
    duration: 22.15,
    peak: 0,
    music: { bpm: 65, firstBeat: 0.02, loops: true },
    source: { freesoundId: 806474, title: "Down-fi Hop w Bass 65bpm", author: "CVLTIV8R", preview: preview(806474, 2520418), trim: [0, 22.15] },
  },
  "music-synthwave": {
    use: "energetic, futuristic synthwave: tech, AI, gaming and fast promo edits",
    duration: 31.22,
    peak: 0,
    music: { bpm: 123, firstBeat: 0.03, loops: true },
    source: { freesoundId: 841299, title: "Upbeat Game Loop - Aurora Ride", author: "Venus17", preview: preview(841299, 18297633), trim: [0, 31.22] },
  },
  "music-dreamy": {
    use: "warm, dreamy cinematic pop with synth pads and strings: stories, emotional and premium videos",
    duration: 60.22,
    peak: 0,
    music: { bpm: 107.7, firstBeat: 0.2, loops: false },
    source: {
      freesoundId: 814843,
      title: "Wonders [cinematic background music]",
      author: "Seth_Makes_Sounds",
      preview: preview(814843, 13228046),
      trim: [40.17, 100.39],
    },
  },
} as const satisfies Record<string, RealSound>;

export type RealSoundName = keyof typeof REAL_SOUNDS;

export const REAL_SOUND_NAMES = Object.keys(REAL_SOUNDS) as RealSoundName[];

export function isRealSoundName(name: string | null | undefined): name is RealSoundName {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(REAL_SOUNDS, name);
}

/** The bank by kind, in the order the editor's sound library shows it. */
export const REAL_SOUND_GROUPS: readonly { label: string; names: readonly RealSoundName[] }[] = [
  { label: "Whooshes", names: ["whoosh-fast", "whoosh-soft", "whoosh-cinematic", "swish-fast", "swish-quick", "swoosh-short"] },
  { label: "Hits", names: ["impact-cinematic", "boom-deep", "bass-drop", "punch", "thud"] },
  { label: "Builds and accents", names: ["riser", "magic-transition", "sparkle", "glitch"] },
  { label: "Interface", names: ["pop", "click", "click-soft", "tick", "ding", "success", "camera-shutter"] },
  { label: "Typing", names: ["typing", "typing-long"] },
  { label: "Music beds", names: ["music-corporate", "music-playful", "music-hiphop", "music-synthwave", "music-dreamy"] },
];

/** The bed's tempo and beat grid, when the sound is music. */
export function realSoundMusic(name: string | null | undefined): RealSound["music"] {
  return isRealSoundName(name) ? (REAL_SOUNDS[name] as RealSound).music : undefined;
}

/** "whoosh-fast" → "Whoosh fast" (layer names and the editor's list). */
export function realSoundLabel(name: string): string {
  const words = name.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Trimmed length of a real sound, or undefined for other names. */
export function realSoundDuration(name: string | null | undefined): number | undefined {
  return isRealSoundName(name) ? REAL_SOUNDS[name].duration : undefined;
}

/** Where the editor's preview fetches a real sound (downloaded and cached by the server on first use). */
export function realSoundUrl(name: RealSoundName): string {
  return `/api/audio/sound/${name}`;
}

/** The effects as the contract lists them: name, length, hit time, use. */
export function realSoundsMarkdown(): string {
  return REAL_SOUND_NAMES.filter((name) => !realSoundMusic(name))
    .map((name) => {
      const s: RealSound = REAL_SOUNDS[name];
      return `- \`${name}\` (${s.duration} s, hits at ${s.peak} s): ${s.use}`;
    })
    .join("\n");
}

/** The music beds as the contract lists them: name, length, tempo, first beat, whether it loops, use. */
export function realMusicMarkdown(): string {
  return REAL_SOUND_NAMES.flatMap((name) => {
    const s: RealSound = REAL_SOUNDS[name];
    if (!s.music) return [];
    return [`- \`${name}\` (${s.duration} s, ${s.music.bpm} BPM, first beat at ${s.music.firstBeat} s${s.music.loops ? ", loops seamlessly" : ", plays once"}): ${s.use}`];
  }).join("\n");
}
