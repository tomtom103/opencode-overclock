# opencode-overclock

Power-ups for [opencode](https://opencode.ai). Features other harnesses have, opencode doesn't — plus ones nobody has yet. Each = module, toggleable. Module dies when opencode ships native equal/better.

## Install

npm (opencode.json):

```json
{ "plugin": ["opencode-overclock"] }
```

Local dev: symlink or copy into `.opencode/plugins/`.

## Config

`.opencode/overclock.json` (optional, missing = defaults):

```json
{
  "features": {
    "hello": true,
    "some-feature": { "option": "value" },
    "other-feature": false
  }
}
```

`true`/`false` toggle. Object = on + options.

## Layout

```
src/
  index.ts          entry: config -> init modules -> merge hooks
  types.ts          FeatureModule contract
  config.ts         config loader
  merge.ts          hook composition (many modules, same hook -> sequential)
  features/
    index.ts        registry (order = hook call order)
    hello.ts        demo module, delete when real one lands
```

## Add feature

1. `src/features/<name>.ts`, export `FeatureModule`
2. Register in `src/features/index.ts`
3. Doc one line in `docs/roadmap.md`

## Docs

- [docs/roadmap.md](docs/roadmap.md) — planned features
- [docs/cc-opencode-map.md](docs/cc-opencode-map.md) — Claude Code hook <-> opencode hook mapping (research)

## Dev

```sh
bun install
bun run check     # typecheck + format check
bun run format
```
