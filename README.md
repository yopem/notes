# Still Notes

A local-first native desktop notebook, built with GPUix and Bun. Inspired by
ZenNotes. Uses Yopem UI design values, translated to native renderer styles. No
Electron, web view, CSS, or StyleX.

## Setup

Install Bun 1.3 or later. Use a desktop system with a GPU driver supported by
GPUix: Metal on macOS, DirectX on Windows, or Vulkan on Linux.

```sh
bun install --frozen-lockfile
bun run dev
```

GPUix React and native are pinned to the same version. Upgrade them together.

## Checks

```sh
bun run check
bun run lint
bun run format:check
bun run test:store
bun run test:native
bun run build
```

Native E2E checks launch a real window with a temporary data directory. Reports
and screenshots are saved in `docs/artifacts/`. Linux GPUix does not support the
headless test renderer, and its background-focus option is not honored.

## License

See `LICENSE.md` for project terms and source credits.
