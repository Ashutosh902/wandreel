# Wandreel Figma Handoff (Test Pack)

## Screens exported

- `artifacts/figma-handoff/screens/01-discover-home.png`
- `artifacts/figma-handoff/screens/02-category-taste.png`
- `artifacts/figma-handoff/screens/03-category-activity.png`

## Frame setup in Figma

- Device frame: `430 x 932` (mobile preview equivalent)
- Content shell max width: `390`
- Corner radius (phone shell): `40`

## Core design tokens (current)

- Font family: `Nunito Sans`
- Primary text: `#10213F`
- Accent orange: `#F4511E`
- Discover surface bg: `linear-gradient(135deg, #FCF8F0 0%, #F7F2E9 48%, #EFE8DC 100%)`
- Card radius common: `16` to `20`
- Bottom nav height intent: compact fixed bar with top border `#E5E7EB`

## Components to edit manually in Figma

- Top header: logo mark + centered location pill + notification button
- Hero card: Golghar background + dark readability overlay + headline copy
- Bucketlist card: dark panel + 4 category tiles
- Category page hero: compact image strip + top-left text
- Bottom nav: fixed 5-item nav (Discover, Map, Add, Connect, Login)

## Manual edit workflow (recommended)

1. Import all PNGs into Figma on separate frames.
2. Rebuild components as editable layers on top (Auto Layout + constraints).
3. Keep naming stable: `Header`, `Hero`, `Bucketlist`, `CategoryHero`, `BottomNav`.
4. After edits, share updated Figma screens; we map deltas back into React/CSS in small PR-sized steps.

## Notes

- This is a visual handoff, not live two-way binding.
- React code remains source of truth for behavior and responsive logic.
