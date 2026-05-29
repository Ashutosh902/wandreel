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
- `home/AddScreen.tsx`: Add tab capture flow (paste, analyze, detect, preview, save).

## Home navigation behavior

- Bottom navigation is static and always visible inside the mobile shell.
- `Discover` renders the full home feed.
- `Login` renders the login/profile screen module.
- `Map` renders the interactive category-toggle map module.
- `Add` renders a branded capture flow screen with local mock analyze/detect states.
- `Connect` renders its own page panel.
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

## Phase note: readability refinement pass

- Improved hero title readability with a subtle bottom image gradient overlay and stronger text legibility treatment.
- Increased contrast and legibility for bucketlist summary labels/counts and category tile labels/counts.
- Refined recently-added card text contrast and line-height for cleaner scanability without layout redesign.

## Phase note: recently-added carousel polish

- Recently added cards now use intentional mobile peek-scroll behavior with snap alignment, controlled card width, and consistent side padding/gaps.
- Card text and container boundaries remain fully readable while only the card container peeks off-screen.

## Phase note: final micro-polish pass

- Applied final readability/spacing tuning across hero, location pill, bucketlist copy hierarchy, recently-added typography, and bottom-nav label legibility.
- Layout, color theme, images, navigation behaviors, and carousel interaction pattern remain unchanged.

## Phase note: Taste compact list redesign

- Category detail architecture is reusable, but compact utility-first redesign is applied only to `Taste` in this pass.
- Taste now uses compact header, nearest-first utility row, horizontal filter chips, richer restaurant cards, and a `View map` affordance.

## Phase note: Taste refinement tweak pass

- Taste compact header is simplified to a single `Taste` title with darker premium warm gradient styling and subtle watermark treatment.
- Utility row copy is reduced to `18 saved places` and `Nearest first`; chips are simplified to `All 18`, `Trending`, and `Visited`.
- Taste cards are cleaned up by removing source/status text lines while preserving distance-first scanability and map action affordance.
- `View map` now switches to Map with Taste-only active filtering; navigating back to Discover returns to the same Taste category context.

## Phase note: Taste list-first interaction pass

- Taste header/utility summary blocks are removed to prioritize immediate list scanning.
- Taste filter strip now leads with `All 18`, `Trending`, `Visited`, `Date-night`, `Budget`, with `View map` kept in the same utility row.
- Tapping a Taste card opens a bottom-sheet place preview (image, full address, `Directions`, `Watch video`) while keeping navigation and app context intact.

## Phase note: Taste top-controls layout fix

- Taste top controls are now split into two clean rows: `Taste + View map` on row one, horizontal filter chips on row two.
- `View map` is kept fixed/visible and no longer competes with chip scrolling, preventing overlap/crowding.

## Phase note: Taste searchable list refinement

- Taste now includes a compact `Search saved restaurants...` input below the location bar that filters saved Taste rows in-place.
- Filter chips expanded to `All`, `Trending`, `Visited`, `Date-night`, `Budget`, `Street-style`, `Iconic` with horizontal scroll.
- Restaurant rows are now compact thumbnail-led list cards with distance aligned top-right and metadata below; source/status remain hidden from list view and continue inside the bottom sheet only.

## Phase note: Taste top-stack spacing polish

- Refined vertical rhythm between search, title/action row, chips, and first list card for cleaner hierarchy without layout redesign.
- `View map` alignment, chip reachability, and list-start spacing were tuned to reduce crowding while preserving compactness.

## Phase note: Taste micro-alignment cleanup

- Removed visible clipped text artifacts from Taste list thumbnails by tightening thumbnail crop framing.
- Refined row-card padding/alignment so thumbnail, title, distance, and metadata align more consistently.
- Slightly strengthened `Taste` title prominence while keeping the same minimal row pattern.

## Phase note: Unified category list rollout

- Extended the successful Taste list pattern to `Activity`, `Stay`, and `Explore` using one shared category-detail structure.
- Each category now has its own search placeholder, chip set, accent theme, and nearest-first mock item dataset.
- All category items now use consistent compact thumbnail rows and open the same bottom-sheet detail interaction (`image`, `address`, `Directions`, `Watch video`).
- Category accent tokens were normalized across all four pages so title bar/chips/`View map`/distance/action colors stay consistent per category family.

## Phase note: Map radius coverage feedback

- Map now renders a translucent radius coverage circle centered on the active search center and smoothly scales it with the vertical km slider.
- Pins outside selected radius are de-emphasized, while in-range pins stay fully readable.
- Added a subtle in-map count pill showing how many visible places are currently inside radius.
- Applied a Pinshort-inspired restaurant map polish: calmer base tones, cleaner road contrast, and refined radius/pin emphasis hierarchy.
- Map top controls were simplified to a single-line primary location bar with clearer separation from the secondary category chip row for cleaner hierarchy.
- Tapping any map pin now opens a bottom-sheet place preview (image, name, address, category-relevant timing/meta, and `Directions`) with outside-tap dismiss behavior.

## Phase note: Global shell stabilization

- Bottom navigation is now anchored as a direct shell layer (outside page scroll containers) for consistent visibility across Discover, Add, Map, Login/Profile, and category pages.
- Non-map screens now scroll internally with shared bottom-safe padding, while the map surface remains non-scrollable and keeps floating controls above nav.
- Login bottom sheet/backdrop now stop above the persistent bottom nav and no longer cover it.

## Phase note: Scrollbar chrome hidden

- Hidden vertical scrollbar chrome across app scroll surfaces (home/add/category/profile/login-sheet) while preserving touch/mouse scrolling behavior.

## Phase note: Add typography hierarchy polish

- Refined Add-only type scale and spacing so `Add a Wandreel` is the dominant headline, paste-card copy is clearly secondary, and `Analyze link` remains strong without oversized visual weight.
- Tightened Add typography to match Home/Taste voice more closely: stronger dark-navy headline contrast, calmer helper text, and cleaner CTA/input type rhythm without structural or logic changes.

## Phase note: Desktop preview vs mobile fullscreen shell

- Desktop keeps the centered rounded phone mockup shell for design preview.
- Mobile viewport (`<=640px`) now always renders a full-screen edge-to-edge app shell with safe-area-aware viewport/nav behavior.

## Phase note: Phone OTP integration (XLSX-backed)

- Login phone flow now calls API endpoints to request and verify OTP instead of local-only mock completion.
- OTP and user records are persisted to `database/tables/auth_otp.xlsx` and `database/tables/users.xlsx` as the initial table-backed auth layer.
- Login onboarding now applies provider-aware identity flow: Google/Facebook reuse provider name/email/avatar when present, Apple prompts name only if missing, and email follows passwordless link-first then name collection.

## Phase note: Unified screen frame sizing (safe pass)

- Standardized the phone shell to a fixed viewport-height frame for consistent perceived height across tabs.
- Enabled internal scrolling only on non-map surfaces to preserve existing map interaction and overlay behavior.

## Phase note: Add-only frame height stabilization

- Applied an Add-tab-only minimum surface height so the Add screen keeps a full mobile frame feel without changing shared shell behavior used by Discover/Map/category screens.

## Phase note: Login compact social row

- Login join sheet now uses a compact social icon row (`Google`, `Apple`, `Facebook`) instead of large stacked provider rows.
- Email entry is now inline on the same join step with `Continue with email`, and phone auth is reduced to a secondary `Use phone instead` link.

## Phase note: Login social icon fidelity + validation polish

- Replaced placeholder social letters with proper brand-style inline SVG icons for Google, Apple, and Facebook.
- Email validation now shows a clean inline error (`Please enter a valid email address.`) only after invalid submit attempts.

## Phase note: Login sheet sizing polish

- Reduced join-sheet headline size slightly and relaxed line-height for calmer scanability.
- Social provider buttons were resized to a tighter 50px-class height, with icon centering preserved.
- Tightened reassurance note density and slightly increased input-to-email-CTA spacing.

## Phase note: Login error-state polish

- Technical network failures (for example `Failed to fetch`) are now mapped to a user-friendly inline login error: `Couldn’t connect. Please try again.`

## Phase note: Real Google OAuth wiring

- Google icon now launches real Google account chooser via Google Identity Services, then verifies profile through backend `/api/auth/google/verify`.
- Login is no longer mocked for Google; missing OAuth config now surfaces `Google login is not configured yet.`.

## Phase note: Real Auth Identity v1 session wiring

- Login tab now resolves signed-in state from backend `/api/auth/session/me` (HttpOnly cookie session), replacing local-only identity state.
- Email login now uses backend OTP request/verify endpoints; typed email is only trusted after OTP verification.
- Profile completion now calls authenticated display-name endpoint and logout revokes backend session.

## Phase note: Session-aware login sheet auto-open

- Login sheet auto-open is now gated by resolved backend session state to prevent showing auth prompts for already signed-in users.
- Logged-out users keep the existing default behavior: join sheet auto-opens on Login tab entry.
- Profile inline `Edit name -> Save` now persists display name through authenticated backend profile update and immediately refreshes greeting state.

## Phase note: Protected saved-place ownership API

- Added authenticated saved-place endpoints (`GET/POST/DELETE /api/saved-places`) that always scope rows to server-resolved session `user_id`.
- Backend ignores any client-provided identity fields and enforces ownership from verified session only.

## Phase note: Legal pages wired in Profile

- `Terms and conditions`, `Privacy Policy`, and `Open-source libraries` rows now open dedicated in-app legal pages with back navigation.
- Login-sheet legal links (`Terms`, `Privacy Policy`) now route to the same in-app legal pages for consistent access.

## Phase note: Profile notification toggle

- Replaced static `Notifications` settings row with an interactive on/off switch in Profile settings.
- Toggle uses color state: `ON` = green and `OFF` = red.

## Phase note: iOS-style back gesture + micro screen transitions

- Added left-edge swipe-right back gesture at app-shell level for primary back paths (category -> Discover, Map -> Discover, other tabs -> Discover).
- Added optional right-edge swipe-left back gesture for symmetry on large-screen one-hand usage.
- Added subtle horizontal slide transition when switching tabs/screens to improve perceived polish without redesign.

## Phase note: Market-ready interaction polish layer

- Added shared UX provider with global toasts (`success/error/info`) and online/offline status feedback.
- Added reduced-motion-safe interaction defaults and lightweight press feedback across tappable controls.
- Added swipe-down bottom-sheet dismissal for login, map pin preview, and category place detail sheets.
- Added pull-to-refresh affordance on non-map scroll surfaces and polished empty/loading states for category/map/add/profile.
