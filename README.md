# Motion Studio

Layer-based editor for **Claude Motion / Claude Design** animations.

Claude Motion writes animations as code (a `<Stage>` with `<Sprite>` children, pure function of
time) and exports a flat MP4. Motion Studio imports that code, shows every element as an editable
**layer** (timeline + layers panel), lets you add / delete / retime / reorder layers by hand, and
lets Claude rewrite **just the layer you selected** from a prompt. Export renders frames headlessly
and encodes MP4 / WebM (alpha) / MOV (alpha) / GIF / PNG sequence.

See `docs/PROPOSAL.fa.md` (Persian) for the product proposal and `docs/CONTRACTS.md` for the
module contracts.

## Run

```bash
pnpm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY
pnpm dev                      # http://localhost:3000
```

Export needs Chromium (set `CHROMIUM_PATH` or let playwright-core find one) and `ffmpeg` on PATH.
