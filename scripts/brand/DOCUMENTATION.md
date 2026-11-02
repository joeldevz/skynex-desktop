# Brand assets

## Ownership

`scripts/brand` owns every drawing of the Skynex mark. `geometry.mjs` describes the S monogram; `raster.mjs` turns it into PNG and `.ico` files; `generate.mjs` writes each file where its runtime reads it. `bun run brand:generate` rewrites all of them; `bun run brand:generate --check` fails when a generated text file was edited by hand.

The logo has four drawings, each for a kind of place:

| Drawing | Where it shows |
|---|---|
| App icon, an Icon Composer document (`packages/electron/resources/icons/AppIcon.icon`) | macOS Dock and Finder, the iOS app |
| Icon without a tile: the S monogram in Skynex green | Windows, Linux, VS Code Marketplace, phone home screens, PWA and Android |
| In-app logo: the S monogram in the current foreground color | Splash, About, sign-in and empty states |
| Glyph: the S monogram | macOS menu bar, favicon, VS Code activity bar and title buttons, model picker sprite, Android notification and themed icon, iOS Control Center |

The macOS menu bar animation lives in `packages/electron/tray.mjs`; this module only draws its frames. `OpenChamberLogo.tsx` renders the in-app logo from the generated `openChamberLogoArt.ts` and owns its loading animation.

## Invariants

- Every logo file in the repository comes out of `generate.mjs`, except the iOS widgets which draw the same S path in SwiftUI (`SMarkView` in `packages/mobile/ios/App/OpenChamberWidget/WidgetShared.swift`). A mark change updates that SwiftUI drawing with the generated assets; `--check` does not cover it.
- The four HTML documents that show before React (the web `index.html`, the Electron splash in `early-startup.mjs`, the VS Code loader in `webviewHtml.ts`, the headless server page in `static-routes-runtime.js`) and `OpenChamberLogo.tsx` draw the same in-app logo. The HTML documents carry it between `<!-- brand:flat-logo:start -->` and `<!-- brand:flat-logo:end -->`; the generator rewrites only that region.
- The in-app logo is drawn in `currentColor` (or the splash stroke colour), so it remains visible in light and dark themes.
- Text outputs are checked by `generate.test.mjs`; image bytes are not, because they depend on the libvips build.
- On macOS with Xcode 26 the generator also compiles `Assets.car` and `icon.icns` with `actool`, renders `dev-icon.png` with Icon Composer's `ictool`, and writes the Control Center SF Symbol with `swiftdraw`. Elsewhere those files stay as they are.

## Decisions

### Why one script and not exported files

The logo used to live in about forty hand-exported files and six inline drawings that had to be kept in step by hand. A redesign touched all of them. With the shapes in code, the next change is one edit and one run, and a test catches a file edited on its own.

### Why the app icon is layered and not one picture

macOS turns a single flat picture into a grey smudge in Clear and Tinted: it can only reduce it to its brightness. Separate layers (shell, three tiers) let the system draw each as its own glass. The tiers appear twice: white with baked opacity for the light Default, opaque and coloured for Dark, Clear and Tinted, so each tier keeps its own tone there. A layer hidden in an appearance keeps glass off in it, or its glass still shows.

### Why the small Windows sizes use the same S mark

The `.ico` and 16 px favicon render the same S glyph as larger surfaces, so the app keeps one recognizable mark at every size. Sharp rasterizes the vector directly at the target dimensions.

### Why the macOS dev icon is rendered by ictool and not drawn

The release Dock icon is glass rendered by the system. A flat drawing next to it looked like a different app. `ictool` renders the real document the way the Dock does, and the tape goes on top.
