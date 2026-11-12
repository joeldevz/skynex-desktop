# Brand assets

## Ownership

`scripts/brand` owns every drawing of the Skynex mark. `skynex-logo.svg` and `skynex-logo-ribbon.svg` are the supplied canonical filled silhouette and startup animation. `geometry.mjs` projects their geometry onto icon canvases; `raster.mjs` turns it into PNG and `.ico` files; `generate.mjs` writes each file where its runtime reads it. `bun run brand:generate` rewrites all of them; `bun run brand:generate --check` fails when a generated text file was edited by hand.

The logo has four drawings, each for a kind of place:

| Drawing | Where it shows |
|---|---|
| App icon, an Icon Composer document (`packages/electron/resources/icons/AppIcon.icon`) | macOS Dock and Finder, the iOS app |
| Icon without a tile: the S monogram in Skynex green | Windows, Linux, VS Code Marketplace, phone home screens, PWA and Android |
| In-app logo: the S monogram in the current foreground color | Splash, About, sign-in and empty states |
| Glyph: the S monogram | macOS menu bar, favicon, VS Code activity bar and title buttons, model picker sprite, Android notification and themed icon, iOS Control Center |

The macOS menu bar animation lives in `packages/electron/tray.mjs`; this module only draws its frames. `OpenChamberLogo.tsx` renders the in-app logo from generated `openChamberLogoArt.ts`. Its supplied finite ribbon animation appears only in the splash variant when `isAnimated` is set.

## Invariants

- Every generated logo uses the same filled silhouette with uniform scaling. iOS widgets draw that silhouette in SwiftUI (`SMarkView` in `packages/mobile/ios/App/OpenChamberWidget/WidgetShared.swift`); `--check` does not compile or verify that native drawing.
- The four HTML documents that show before React (the web `index.html`, the Electron splash in `early-startup.mjs`, the VS Code loader in `webviewHtml.ts`, the headless server page in `static-routes-runtime.js`) and `OpenChamberLogo.tsx` use the same source geometry. The HTML documents carry it between `<!-- brand:flat-logo:start -->` and `<!-- brand:flat-logo:end -->`; the generator rewrites only that region.
- The finite startup ribbon follows the supplied discrete `d` frames and opacity fade. Reduced-motion media rules expose the still path instead.
- The in-app logo is drawn in `currentColor` (or the splash stroke colour), so it remains visible in light and dark themes.
- Text outputs are checked by `generate.test.mjs`; image bytes are not, because they depend on the libvips build.
- On macOS with Xcode 26 the generator also compiles `Assets.car` and `icon.icns` with `actool`, renders `dev-icon.png` with Icon Composer's `ictool`, and writes the Control Center SF Symbol with `swiftdraw`. Elsewhere those files stay as they are.

## Decisions

### Why one script and not exported files

The logo used to live in about forty hand-exported files and six inline drawings that had to be kept in step by hand. A redesign touched all of them. With the shapes in code, the next change is one edit and one run, and a test catches a file edited on its own.

### Why the app icon is layered and not one picture

The filled mark occupies one transparent layer. Icon Composer applies the existing light, dark and tinted treatments to that silhouette, so the icon keeps its system appearance without baking a background into the drawing.

### Why the small Windows sizes use the same S mark

The `.ico` and 16 px favicon render the same S glyph as larger surfaces, so the app keeps one recognizable mark at every size. Sharp rasterizes the vector directly at the target dimensions.

### Why the macOS dev icon is rendered by ictool and not drawn

The release Dock icon is glass rendered by the system. A flat drawing next to it looked like a different app. `ictool` renders the real document the way the Dock does, and the tape goes on top.

### Why the supplied path stays filled

Redrawing the outline as a stroke changes its corners and silhouette at small sizes. The supplied filled path stays canonical, and generated variants use uniform transforms while keeping their platform-specific colors and icon treatments.

### Why startup keeps the finite path animation

The supplied ribbon changes path geometry, so transform-only motion would change the requested design. Its discrete animation ends after 1.6 seconds and freezes; ordinary logos remain static. Startup readiness never waits for that animation. Animated, reduced-motion and static startup stages use the ribbon's view box to keep the mark the same size during handoff.

`bun run profile:animation -- --variant brand-static --variant brand-ribbon --variant brand-settled --count 1 --duration 3 --settle 1 --json` measures the source SVG. On Linux headless Chromium the 3-second active window used 0.66% main-thread time and the settled variant drew 0.7 frames per second. The positive opacity control drew 60.1 frames per second. These are isolated rendering measurements, not headed CPU or native-platform measurements.
