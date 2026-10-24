/** The export's sound mix: merging the clips the render pages report, and the ffmpeg graph. */
import { describe, expect, it } from "vitest";
import { type AudioClip, type PreparedClip, buildAudioMixArgs, mergeClips } from "../audio";

const clip = (over: Partial<AudioClip> = {}): AudioClip => ({
  key: "a",
  sfx: "whoosh",
  start: 0,
  end: null,
  from: 0,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  loop: false,
  ...over,
});
const input = (over: Partial<AudioClip> = {}, length?: number): PreparedClip => ({ clip: clip(over), file: `/job/${over.key ?? "a"}.wav`, length });
const graphOf = (args: string[] | null) => args![args!.indexOf("-filter_complex") + 1];

describe("mergeClips", () => {
  it("keeps each clip once across workers and drops malformed entries", () => {
    const a = clip({ key: "a" });
    const b = clip({ key: "b", sfx: undefined, src: "data:audio/wav;base64,AA==" });
    const merged = mergeClips([[a, b], [a], "nope", [{ key: "c", start: "1" }, null, { ...a, key: "d", volume: Number.NaN }]]);
    expect(merged).toEqual([a, b]);
  });
});

describe("buildAudioMixArgs", () => {
  const range = { start: 0, end: 8 };

  it("returns null when nothing sounds inside the range", () => {
    expect(buildAudioMixArgs([], range, 8, "/job/audio.wav")).toBeNull();
    expect(buildAudioMixArgs([input({ start: 9 }, 1)], range, 10, "/job/audio.wav")).toBeNull();
  });

  it("trims a built-in sound to its length, delays it to its start and pads the mix to the range", () => {
    const args = buildAudioMixArgs([input({ start: 1.5, volume: 0.6 }, 0.8)], range, 8, "/job/audio.wav");
    expect(args!.slice(0, 6)).toEqual(["-y", "-hide_banner", "-loglevel", "error", "-i", "/job/a.wav"]);
    expect(args!.slice(-9)).toEqual(["-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "/job/audio.wav"]);
    const graph = graphOf(args);
    expect(graph).toContain("[0:a]atrim=start=0:duration=0.8,asetpts=PTS-STARTPTS");
    expect(graph).toContain("volume=0.6");
    expect(graph).toContain("adelay=delays=1500:all=1[a0]");
    expect(graph).toContain("[a0]anull,alimiter=limit=0.95,apad=whole_dur=8,atrim=duration=8[out]");
  });

  it("cuts clips at the export range and fades only the edges that are inside it", () => {
    const args = buildAudioMixArgs(
      [input({ key: "m", src: "data:", sfx: undefined, start: 0, end: 10, fadeIn: 1, fadeOut: 2 })],
      { start: 2, end: 6 },
      10,
      "/job/audio.wav",
    );
    const graph = graphOf(args);
    expect(graph).toContain("atrim=start=2:duration=4");
    expect(graph).not.toContain("afade");
    expect(graph).not.toContain("adelay");
    expect(graph).toContain("apad=whole_dur=4,atrim=duration=4");

    const whole = graphOf(buildAudioMixArgs([input({ start: 1, end: 5, fadeIn: 1, fadeOut: 2 }, 6)], range, 8, "/o.wav"));
    expect(whole).toContain("afade=t=in:st=0:d=1,afade=t=out:st=2:d=2,adelay=delays=1000:all=1");
  });

  it("loops beds to the stage end and mixes several clips without normalising", () => {
    const args = buildAudioMixArgs(
      [input({ key: "bed", sfx: "pad", loop: true }, 8), input({ key: "hit", start: 2 }, 0.5)],
      { start: 0, end: 12 },
      12,
      "/o.wav",
    );
    expect(args!.slice(4, 10)).toEqual(["-stream_loop", "-1", "-i", "/job/bed.wav", "-i", "/job/hit.wav"]);
    const graph = graphOf(args);
    expect(graph).toContain("[0:a]atrim=start=0:duration=12");
    expect(graph).toContain("[1:a]atrim=start=0:duration=0.5");
    expect(graph).toContain("[a0][a1]amix=inputs=2:normalize=0:dropout_transition=0");
  });

  it("clamps the volume and starts a file clip at its offset", () => {
    const graph = graphOf(buildAudioMixArgs([input({ start: 0, end: 3, from: 1.25, volume: 4 })], range, 8, "/o.wav"));
    expect(graph).toContain("atrim=start=1.25:duration=3");
    expect(graph).toContain("volume=1");
  });
});
