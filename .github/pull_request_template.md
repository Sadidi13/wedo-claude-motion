## What and why

<!-- One or two sentences: the change and the reason for it. -->

## How it was checked

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] Tried in the editor (describe what you clicked), if the change is visible there

## Security

- [ ] No secrets, tokens or personal paths in the diff
- [ ] New `/api` routes go through the same-origin guard in `src/proxy.ts` and validate their input
