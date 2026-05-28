# UI Module Guide

This folder owns all Wandreel frontend architecture and components.

## Folder ownership

- `layout/`: page shells, startup flow, app transitions.
- `splash/`: opening app splash and launch-specific visuals.
- `theme/`: design tokens and UI constants.
- `assets/brand/`: SVG-first brand assets.
- `home/`: mobile home screen modules (data + composed sections + styles).
- `map/`: map tab module (category chips, pin filtering, radius controls).
- `profile/`: login/profile tab module (screen + data + styles).

## Splash policy

- Trigger: `every_open`
- Duration: `2000ms`
- Owner: `layout/AppShell.tsx` + `splash/OpeningSplash.tsx`

## Brand asset policy

- Use SVG-first for logos and wordmarks.
- Keep source brand proportions unchanged.
- Use theme tokens for colors and typography references.

## Home module ownership

- `home/HomeScreen.tsx`: top-level composition for the home screen.
- `home/home.css`: prototype-faithful CSS styling for home layout and components.
- `home/home.data.ts`: static UI data and runtime invariants for this phase.
- `home/LocationSelector.tsx`: location row section.
- `home/HeroCard.tsx`: opening message card.
- `home/BucketlistSummary.tsx`: dark bucketlist summary block with category tiles.
- `home/CategoryDetailPage.tsx`: per-category drill-down page rendered from Discover.
- `home/RecentlyAddedCarousel.tsx`: horizontal recently-added cards and view-all card.
- `home/BottomNav.tsx`: 5-item bottom navigation with active state.

## Home navigation behavior

- Bottom navigation is static and always visible inside the mobile shell.
- `Discover` renders the full home feed.
- `Login` renders the login/profile screen module.
- `Map` renders the interactive category-toggle map module.
- `Add` and `Connect` render their own page panels.
- Active tab is indicated by the orange top bar on the selected nav item.

## Phase note: bucketlist tile crop refinement

- Bucketlist category tile images (Taste, Activity, Stay, Explore) now use tighter in-tile crop alignment to remove top-edge white strip artifacts.
- Card size, spacing, labels/counts, click behavior, and responsive layout remain unchanged.

## Phase note: hero background image update

- Discover hero (`Patna discoveries, ready to stroll`) now uses a Golghar, Patna photo background with a readability tint overlay instead of a flat gradient fill.
- Hero layout, text content, spacing, and interactions remain unchanged.

## Phase note: top-bar space optimization

- Removed top `Wandreel` wordmark and `From scroll to stroll` tagline from Discover header.
- Moved and centered the location pill into the top row between logo mark and notification button to reclaim vertical space.

## Phase note: category tile drill-down

- `Taste`, `Activity`, `Stay`, and `Explore` tiles are now clickable and open dedicated in-Discover category pages.
- Bottom navigation remains persistent and fully interactive while category pages are open.

## Phase note: category dummy visibility data

- Each category page now includes dummy highlights and sample saved-place rows for better visibility during UI evaluation.
- Data is local/static and prepared for later API-backed replacement.
