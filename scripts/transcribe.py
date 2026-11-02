"""
Speech to text for the media library (docs/VIDEO.md): faster-whisper with word timestamps, run by the
Motion Studio server (src/lib/server/media/transcribe.ts) on a 16 kHz mono WAV it extracted with ffmpeg.

    python transcribe.py <speech.wav> [--language fa] [--model large-v3] [--device cpu] [--compute-type int8]

Prints one JSON object:
    {"language": "fa", "duration": 41.9,
     "segments": [{"start": 0.0, "end": 2.4, "text": "...", "words": [{"start": 0.0, "end": 0.4, "word": "..."}]}]}

Needs `faster-whisper` and `numpy` (pip install faster-whisper). The model is downloaded once into the
Hugging Face cache on first use.
"""

import argparse
import json
import sys
import wave


def read_wav(path):
    """16-bit PCM WAV as float32 samples. Read directly: some PyAV builds reject faster-whisper's decode options."""
    import numpy as np

    with wave.open(path, "rb") as source:
        if source.getsampwidth() != 2 or source.getnchannels() != 1:
            raise SystemExit("expected a 16-bit mono WAV")
        frames = source.readframes(source.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--language", default=None)
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        read_wav(args.audio),
        language=args.language or None,
        word_timestamps=True,
        vad_filter=True,
        beam_size=5,
    )
    result = {"language": info.language, "duration": round(info.duration, 3), "segments": []}
    for segment in segments:
        result["segments"].append(
            {
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip(),
                "words": [
                    {"start": round(word.start, 2), "end": round(word.end, 2), "word": word.word.strip()}
                    for word in (segment.words or [])
                ],
            }
        )
    sys.stdout.reconfigure(encoding="utf-8")
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
