/** The real sound bank: groups, measured numbers, preview links and the contract's lists. */
import { describe, expect, it } from "vitest";
import {
  REAL_SOUNDS,
  REAL_SOUND_GROUPS,
  REAL_SOUND_NAMES,
  type RealSound,
  isRealSoundName,
  realMusicMarkdown,
  realSoundDuration,
  realSoundLabel,
  realSoundMusic,
  realSoundUrl,
  realSoundsMarkdown,
} from "../realSounds";

describe("the real sound bank", () => {
  it("lists every sound in exactly one group of the library", () => {
    const grouped = REAL_SOUND_GROUPS.flatMap((group) => group.names);
    expect([...grouped].sort()).toEqual([...REAL_SOUND_NAMES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("keeps lengths, hits and beats consistent with the trims", () => {
    for (const name of REAL_SOUND_NAMES) {
      const sound: RealSound = REAL_SOUNDS[name];
      const [from, to] = sound.source.trim;
      expect(to - from, name).toBeCloseTo(sound.duration, 1);
      expect(sound.peak, name).toBeGreaterThanOrEqual(0);
      expect(sound.peak, name).toBeLessThanOrEqual(sound.duration);
      if (sound.music) {
        expect(sound.peak, name).toBe(0);
        expect(sound.music.bpm, name).toBeGreaterThan(40);
        expect(sound.music.firstBeat, name).toBeLessThan(60 / sound.music.bpm);
      }
    }
  });

  it("downloads each sound from its Freesound preview and plays it from the app's own route", () => {
    for (const name of REAL_SOUND_NAMES) {
      const { freesoundId, preview } = REAL_SOUNDS[name].source;
      expect(preview).toMatch(new RegExp(`^https://cdn\\.freesound\\.org/previews/${Math.floor(freesoundId / 1000)}/${freesoundId}_\\d+-hq\\.ogg$`));
      expect(realSoundUrl(name)).toBe(`/api/audio/sound/${name}`);
    }
  });

  it("answers by name only for sounds in the bank", () => {
    expect(isRealSoundName("whoosh-fast")).toBe(true);
    expect(isRealSoundName("whoosh")).toBe(false); // a synthesized sfx name
    expect(isRealSoundName("toString")).toBe(false);
    expect(isRealSoundName(undefined)).toBe(false);
    expect(realSoundDuration("whoosh-fast")).toBe(2.13);
    expect(realSoundDuration("nope")).toBeUndefined();
    expect(realSoundMusic("music-corporate")).toMatchObject({ bpm: 120, loops: true });
    expect(realSoundMusic("whoosh-fast")).toBeUndefined();
    expect(realSoundLabel("whoosh-fast")).toBe("Whoosh fast");
  });

  it("lists effects and music beds apart for the contract", () => {
    const effects = realSoundsMarkdown();
    const music = realMusicMarkdown();
    for (const name of REAL_SOUND_NAMES) {
      const entry = `\`${name}\``;
      expect(realSoundMusic(name) ? music : effects).toContain(entry);
      expect(realSoundMusic(name) ? effects : music).not.toContain(entry);
    }
    expect(effects).toContain("- `whoosh-fast` (2.13 s, hits at 1.78 s): ");
    expect(music).toContain("- `music-corporate` (60 s, 120 BPM, first beat at 0.03 s, loops seamlessly): ");
    expect(music).toContain("- `music-dreamy` (60.22 s, 107.7 BPM, first beat at 0.2 s, plays once): ");
  });
});
