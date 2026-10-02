# Brand assets

The PassRipple logo, drawn as plain SVG strokes. The wordmark reads "PassRipple", with a capital P and R. The letters are geometric paths, not text, so the logo renders the same everywhere and depends on no font.

| File | Use |
|---|---|
| `passripple-logo.svg` | Wordmark for light backgrounds |
| `passripple-logo-dark.svg` | Wordmark for dark backgrounds |
| `passripple-icon.svg` | Square symbol with rounded corners: favicon and avatars |
| `passripple-icon-square.svg` | Full-bleed square symbol, for stores that apply their own mask |
| `passripple-adaptive-foreground.svg` | Android adaptive icon foreground, inside the 66 dp safe zone |
| `passripple-adaptive-monochrome.svg` | Android themed (monochrome) icon |
| `passripple-feature-graphic.svg` | Google Play feature graphic. Its tagline is text, so export it on a machine with a system sans-serif font |

### PNG exports

The PNG files in `png/` are exported from the SVG sources above. When a source changes, export its PNG again at the same size.

| File | Size | Use |
|---|---|---|
| `play-store-icon-512.png` | 512 × 512, 32-bit | Google Play app icon. Full-bleed: Google Play rounds the corners |
| `play-store-feature-graphic.png` | 1024 × 500, 24-bit, no alpha | Google Play feature graphic |
| `app-icon-1024.png` | 1024 × 1024, no alpha | Expo `icon` (Android and iOS) |
| `adaptive-icon-foreground.png` | 1024 × 1024, transparent | Expo `android.adaptiveIcon.foregroundImage`, with `backgroundColor` `#5B1FE0` |
| `adaptive-icon-monochrome.png` | 1024 × 1024, transparent | Expo `android.adaptiveIcon.monochromeImage` |
| `apple-touch-icon-180.png` | 180 × 180, no alpha | Home screen icon when the web app is installed on iOS |

## Colors

| Color | Hex | Where |
|---|---|---|
| Violet | `#5B1FE0` | Wordmark on light backgrounds, icon background |
| Cyan | `#00D1C7` | Underline wave on light backgrounds |
| Bright cyan | `#00E5D8` | Underline wave on dark backgrounds, the wave in the icon |
| White | `#FFFFFF` | Wordmark on dark backgrounds, the "p" in the icon |

Both versions keep the same structure: a single-color word with a cyan wave below it. On dark backgrounds, and on the violet itself, the word turns white.

In the interface, violet is the primary color (main buttons, links, brand headers) and cyan is decorative only: it is never used for text on white or to signal a state.

Violet was chosen because no well-known brand around PassRipple uses it, so the logo stands out next to sponsors and on a phone's home screen.

## Rules

- Write the name as one word, PassRipple. Never use "Ripple" on its own.
- Do not recolor, stretch or rotate the logo, and do not replace the letters with a font.
- Leave clear space around the wordmark of at least the height of the letter "a".
- Below about 120 px wide, use the icon instead of the wordmark.
