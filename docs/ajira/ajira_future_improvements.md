# Wandreel Future Improvements

## Robust Multi-Entity Extraction Sprint

## Purpose

This document captures the next major Wandreel extraction sprint. The goal is to move from simple single-card extraction to a robust extraction system that can understand real-world videos, extract multiple useful entities, handle weak descriptions, use OCR/Whisper/keyframes from the first attempt, and improve results through upgraded model layers on retry.

This is a future improvement and sprint-planning document, not an immediate patch request.

---

## Core Product Goal

Wandreel should convert one saved video, reel, or link into one or more useful real-world cards.

A single video may contain:

- multiple restaurants
- multiple cafes
- one or more activities
- stays/hotels
- viewpoints or places to explore
- hidden or unclear locations
- on-screen text only
- background music with no speech
- incomplete captions like "DM for location"

The extraction system should not force one video into one title or one category too early.

---

## 1. Extract Multiple Titles, Cards, and Tags from One Video

### Problem

Currently, one video often becomes one extracted card. But real reels frequently mention multiple places or ideas.

Example:

> "3 best cafes and 2 sunset spots in Patna."

This should not become one generic card like:

> "Best cafes and sunset spots in Patna"

Instead, Wandreel should extract individual entities/cards wherever possible.

### Required Behavior

One source video should be able to generate:

- one card
- multiple cards
- zero confident cards, if extraction fails

Each extracted entity should have its own:

- title
- category
- tags
- location hints
- confidence score
- evidence source
- source URL
- editable fields

### Product Principle

Do not force a single primary category too early.

First extract candidate entities, then allow the user to review, edit, save, or discard them.

### Example Output Concept

```json
{
  "sourceUrl": "https://example.com/reel",
  "sourceTitle": "Best hidden places in Patna",
  "entities": [
    {
      "title": "Cafe Example",
      "category": "Taste",
      "tags": ["cafe", "date spot", "coffee"],
      "confidence": 0.82,
      "evidence": ["ocr", "caption"]
    },
    {
      "title": "Sunset Point Example",
      "category": "Explore",
      "tags": ["sunset", "viewpoint", "photo spot"],
      "confidence": 0.76,
      "evidence": ["transcript", "ocr"]
    }
  ]
}
```

---

## 2. Weak Description or Hidden Location Fallback

### Problem

Many reels do not reveal the actual place name in the description.

Common examples:

- "DM for location"
- "Location in comments"
- "Comment 'location' and I'll send it"
- "Guess this place"
- no address or name in caption

In these cases, normal metadata and description extraction may not be enough.

### Required Behavior

Wandreel should still attempt best-effort identification using the full extraction pipeline from the first attempt.

The system should use:

- video frames
- screenshots/keyframes
- OCR text
- visual clues
- location hints
- possible visual search or image matching when available
- map/search verification when available

### Important Product Rule

This must be treated as a best-effort fallback, not a guaranteed result.

If confidence is low, the UI should clearly ask the user to verify or edit manually.

### Example UI State

Possible message:

> "We found a possible match, but we're not fully sure. Please verify before saving."

---

## 3. Multiple Locations in Suggested Title, Missing Location Tag

### Problem

Sometimes a title or caption mentions multiple locations, but the platform location tag is missing.

Example:

> "Best cafes in Patna, Delhi and Bangalore"

The extraction system may not know which city the current card belongs to.

### Required Behavior

When multiple locations are detected and no exact location tag exists, Wandreel should choose the most likely, nearest, or most relevant location using available context.

Possible signals:

- user's current city
- user's saved/default city
- city mentioned most often in caption/transcript/OCR
- visual clues
- creator profile/location hints
- source metadata
- map/search verification

### Product Rule

If the system is not confident, it should not pretend certainty.

It should mark location confidence as low/medium and allow user correction.

### Example

If user is currently in Patna and the video says:

> "Best cafes in Patna, Delhi and Bangalore"

Then Wandreel may prioritize Patna if no stronger signal exists.

---

## 4. No Speech, Only On-Screen Text and Background Music

### Problem

Some videos have no useful spoken audio. The creator only types the place name or recommendations on-screen while music plays.

In this case, Whisper may produce little or nothing useful.

### Required Behavior

OCR must be a first-class extraction source from the first attempt.

The system should:

- capture keyframes/screenshots
- run OCR on visible text
- extract possible place names, titles, tags, prices, city names, and category hints
- verify extracted names using map/search/location checks where possible

### Difference from Point 2

Point 2 is about hidden or missing location information.

Point 4 is about information being present visually on screen, but not in speech or description.

So OCR is the main signal here.

---

## 5. Retry Should Upgrade Intelligence, Not Repeat the Same Attempt

### Problem

If extraction fails and the user taps retry, the system should not simply run the same logic again.

Retry should mean:

- better model
- more compute
- higher timeout
- deeper reasoning
- stricter validation
- better confidence handling

### Final Retry Limit

Wandreel should allow only:

- first extraction attempt
- Retry 1
- Retry 2

After Retry 2 fails, retry should stop.

### Final Failure Message

Suggested message:

> "This one's on us. We couldn't extract it properly. Please edit it manually."

### Retry Button Behavior

- Before first retry: button says `Retry`
- During retry: show friendly loading copy
- After Retry 1 fails: allow Retry 2
- After Retry 2 fails: disable retry and ask for manual edit

Suggested loading copy:

> "We're trying our best model to extract this properly."

---

## Multi-Level Model Approach

### Important Correction

Layer 1 must already apply every possible extraction technique.

Layer 2 and Layer 3 should not introduce brand-new extraction steps.

Instead, every layer uses the same full pipeline, but with better model quality, more timeout, more robustness, and deeper validation.

---

## Extraction Intelligence Ladder

### Layer 1: Full Pipeline, Normal Model

Layer 1 should already use all available extraction methods:

- metadata
- description
- transcript / Whisper
- OCR
- screenshots/keyframes
- visual clues
- location inference
- multi-entity extraction
- category classification
- tag extraction
- validation

This is the default extraction layer.

### Layer 2: Same Pipeline, Stronger Model and More Robust Settings

Layer 2 should use the same pipeline, but upgrade:

- model quality
- timeout
- reasoning depth
- confidence checks
- OCR robustness
- frame sampling tolerance
- validation strictness

No new extraction technique should be added here.

### Layer 3: Same Pipeline, Best Model and Maximum Reasonable Robustness

Layer 3 should again use the same full pipeline, but with the best available model and maximum reasonable processing budget.

It should focus on:

- resolving ambiguous entities
- better handling of multiple places
- stronger title/tag cleanup
- stronger location disambiguation
- stricter confidence scoring
- safer fallback messaging

---

## Attempt Structure

| Attempt | Trigger | Pipeline | Model Level | Goal |
|---|---|---|---|---|
| Attempt 1 | User submits link | Full pipeline | Normal/Fast model | Good default extraction |
| Retry 1 | User taps retry once | Same full pipeline | Better model | Fix weak/partial extraction |
| Retry 2 | User taps retry twice | Same full pipeline | Best model | Final best-effort extraction |
| Manual edit | After Retry 2 fails | No more retry | N/A | User edits manually |

---

## Full Pipeline Must Include from Attempt 1

The first attempt should already be comprehensive.

It should include:

1. Source metadata extraction
2. Description/caption extraction
3. Whisper transcript extraction
4. OCR from video frames
5. Keyframe/screenshot analysis
6. Visual clue extraction
7. Multi-entity detection
8. Category classification
9. Tag generation
10. Location detection
11. Location disambiguation
12. Confidence scoring
13. Validation
14. User-review-ready structured output

Retry should improve quality, not add missing steps.

---

## Confidence Handling

Each extracted card/entity should include confidence fields.

Suggested confidence areas:

- title confidence
- category confidence
- location confidence
- tag confidence
- overall confidence

Example:

```json
{
  "title": "Cafe Example",
  "category": "Taste",
  "confidence": {
    "title": 0.86,
    "category": 0.91,
    "location": 0.62,
    "overall": 0.78
  }
}
```

### UI Behavior by Confidence

High confidence:

- show normal save flow

Medium confidence:

- show "Please verify" hint

Low confidence:

- show manual edit prompt
- do not auto-save silently

---

## Suggested Data Contract Direction

Future extraction response should separate source-level data from entity-level data.

### Source-Level Data

- sourceUrl
- platform
- sourceTitle
- creatorName
- caption
- transcript status
- OCR status
- extraction attempt number
- model layer used
- extraction status

### Entity-Level Data

Each extracted card should have:

- entityId
- title
- category
- tags
- description/subtitle
- city
- locationText
- address
- latitude/longitude if available
- confidence
- evidence
- needsReview
- sourceUrl

---

## UI Review Flow

### Single Entity Found

Show one review card.

User can:

- save
- edit
- retry
- discard

### Multiple Entities Found

Show a stack/list:

> "We found 3 possible cards."

User can:

- save all
- save selected
- edit individual cards
- remove incorrect cards
- retry extraction

### No Entity Found

Show retry state if retries are available.

After Retry 2 fails, show manual edit.

---

## Sprint Acceptance Criteria

The sprint should be considered successful when:

1. One video can return multiple extracted cards.
2. Each card has its own title, category, tags, and confidence.
3. Weak descriptions like "DM for location" do not immediately fail.
4. OCR works for videos with only on-screen text and background music.
5. Multiple-location captions are handled with location disambiguation.
6. First attempt already runs the full extraction pipeline.
7. Retry 1 and Retry 2 use the same pipeline but upgraded model/settings.
8. Retry stops after 2 retries.
9. User gets a clear manual-edit fallback after final failure.
10. UI supports reviewing and saving multiple extracted cards.

---

## Important Product Philosophy

Wandreel is not just saving links.

It is converting messy social videos into structured real-world plans.

So the extraction system must be designed around uncertainty:

- sometimes the video has multiple places
- sometimes location is hidden
- sometimes speech is useless
- sometimes text is only on-screen
- sometimes title mentions many cities
- sometimes no result is reliable

The best product experience is not always perfect automation.

The best experience is:

> extract as much as possible, show confidence, let the user quickly verify/edit, and never pretend low-confidence data is certain.

---

## 6. Reuse Past Extractions, Avoid Re-Extracting the Same Link

### Problem

If the same link is saved again later, Wandreel should not blindly run the full extraction pipeline again.

That would cause:

- unnecessary model/API cost
- repeated Whisper/OCR/video processing cost
- slower user experience
- duplicate extraction records
- inconsistent results for the same source

### Required Behavior

Before starting extraction, Wandreel should first check whether this source has already been extracted in the past.

If yes, the system should try to reuse the existing structured extraction result instead of re-running the whole pipeline.

### Canonical Link Matching

This requires link normalization before lookup.

Examples of normalization:

- remove tracking params / unnecessary query params
- normalize mobile vs desktop URL forms
- normalize trailing slashes
- normalize short links if resolvable
- normalize platform-specific share links into a canonical source key

Examples:

- same Instagram reel shared with extra params
- same YouTube short opened from different URL formats
- same reel shared by copied app link vs browser link

All of these should ideally map to one canonical source identity.

### Product Rule

Same source should have one reusable extraction record, unless a forced re-extraction is explicitly needed.

### Recommended Flow

1. User pastes link
2. System normalizes link into canonical key
3. Database checks existing extraction by canonical key / source fingerprint
4. If valid extraction exists:
   - reuse cached structured result
   - return cards immediately or near-immediately
5. If no valid extraction exists:
   - run normal extraction pipeline
   - store result for future reuse

### What Should Be Stored

For each extracted source, store enough data so reuse is possible:

- canonical source URL
- original submitted URL
- platform
- source fingerprint / unique source key
- extraction status
- extracted entities/cards
- confidence data
- transcript artifacts if retained
- OCR artifacts if retained
- model layer used
- extraction version
- createdAt / updatedAt
- lastVerifiedAt if applicable

### Important Distinction

We should distinguish between:

- source record
- extraction run record
- extracted entity/card record

This allows:

- one source to have multiple historical extraction runs
- latest valid extraction to be reused by default
- future re-extraction if pipeline improves
- auditability when model/version changes

### Suggested DB Direction

Possible tables/entities:

- `sources`
  - canonical URL
  - submitted URL
  - platform
  - source key / fingerprint
  - creator metadata

- `source_extractions`
  - sourceId
  - extractionVersion
  - modelLayerUsed
  - status
  - confidence summary
  - artifact references
  - createdAt

- `source_entities`
  - extractionId
  - title
  - category
  - tags
  - location fields
  - confidence
  - evidence

### Reuse Rules

Default behavior:

- if source already extracted successfully, reuse result
- if source extraction is partial but usable, return it with review flag
- if source extraction failed earlier, allow fresh attempt depending on retry rules
- if extraction version is outdated, optionally allow background/manual re-extraction in future sprint

### Future-Safe Rule

Store extraction version and pipeline version.

That way, when Wandreel improves later, the team can decide:

- reuse old result
- softly refresh old result
- force re-extract only when worth the cost

### Acceptance Criteria

This part should be considered successful when:

1. Same link does not trigger full re-extraction every time.
2. URL normalization maps equivalent links to one canonical source.
3. Existing good extraction results are reused.
4. Duplicate model/OCR/Whisper cost is reduced.
5. Database supports source-level reuse and future re-extraction strategy.

---

## 7. User-Level Duplicate Save Awareness

### Problem

Even if Wandreel avoids re-extracting the same source link globally, the user experience can still feel broken if a user tries to save a place they have already saved earlier from the same link or from a different link.

Example:

- User saved `Cafe Delhi Heights, Patna` from one Instagram reel last week.
- Today the user imports a different YouTube Short that also contains the same place.
- Wandreel should not behave as if this is a completely new save.

### Required Product Behavior

Before saving a newly extracted entity for a user, Wandreel should check whether the same user has already saved the same place earlier.

This should work for:

- same link, same place
- different link, same place
- same place found again through a better extraction later

### User Experience Rules

When a duplicate is detected for the same user:

- show a clear message that this place is already saved
- do not silently create another identical saved card
- optionally let the user:
  - open existing saved card
  - update existing card with better metadata
  - keep both only if product later supports a separate source-history view

### Matching Logic

Duplicate detection should not rely only on URL.

It should use place-level matching such as:

- canonical place id if available
- normalized title/place name
- maps/place provider id if available
- normalized address/location
- geo proximity when exact id is missing

### Recommended Save Decision Order

1. Check whether this exact source URL was already extracted globally.
2. Reuse previous extraction result if available.
3. For each extracted entity, check whether the current user already saved the same place.
4. If yes, mark it as already saved instead of inserting a new duplicate save.
5. If metadata is better than old saved data, optionally support metadata refresh/merge in future.

### Why This Matters

- avoids clutter in user collection
- reduces confusion during save flow
- improves trust in extraction quality
- keeps database cleaner
- supports source reuse without duplicate saves

### Future-Friendly Design Note

The system should separate:

- source link
- extracted entity/place
- user saved place relation

That way:

- many links can map to one place
- one place can be saved once per user
- source history can still be preserved separately

---

## 8. Popularity Index on Every Extracted Card

We should add a popularity indicator to each extracted title/tag card across all categories. The simplest visual is a mobile-signal style 5-bar meter.

### Goal

- Give users a quick sense of how widely saved or discovered a place is.
- Help with trust and prioritization during save/review.
- Later this can also support ranking and recommendation.

### Example Behavior

- same place saved by very few users -> 1 bar
- moderately saved place -> 2 to 4 bars
- very widely saved place, e.g. 20,000 saves -> 5 glowing bars

### Important Clarification

This should be tied to the canonical place/entity, not just one source link.

That means:

- if the same restaurant is saved from Instagram reel A and YouTube short B
- both should contribute to the same popularity score
- as long as our canonical place matching says they are the same place

### Product Rule

Popularity must be calculated at the place/entity level, not at the raw link level.

### Suggested Inputs for Popularity Score

Primary signal:

- unique users who saved the place

Possible later signals:

- total saves
- repeat opens
- directions clicks
- watch video clicks
- recent save velocity
- city-level popularity vs global popularity

### First Version Recommendation

For now keep it simple:

- compute from unique user saves only
- map score to 5 discrete bars

### Example Mapping Idea

This is only a product starting point and can be tuned later:

- 1 bar: 1 to 9 unique saves
- 2 bars: 10 to 99
- 3 bars: 100 to 999
- 4 bars: 1,000 to 9,999
- 5 bars: 10,000+

Alternative:

Use log scaling so very large counts do not dominate too hard.

### UI Behavior

- show compact 5-bar signal icon on every card
- filled bars increase with popularity tier
- top tier can glow subtly
- optionally show exact number on tap / long press / details sheet
- do not clutter default card UI with too many numbers

### Backend / Data Needs

Need canonical place-level stats table or counters such as:

- canonical_place_id
- unique_user_save_count
- total_save_count
- popularity_tier
- last_computed_at

### Duplicate Safety

A single user saving the same place multiple times should not inflate unique-user popularity.

Count distinct users for the primary metric.

### Abuse / Trust Notes

Later we may need:

- spam filtering
- bot protection
- delayed recompute
- minimum verification threshold before showing high popularity

### Why This Matters

This adds:

- social proof
- better ranking signal
- stronger save confidence
- better long-term recommendation quality

---

## 9. Future Idea: Connect Recommendation Economy / Reward-Back System

### Status

This is a future product idea, not part of the current extraction sprint.

### Core Thought

Wandreel Connect can become a recommendation economy where users are incentivized to share useful places, and other users get a pricing benefit when they save from those recommendations.

### Initial Idea Discussed

- first 100 saves free
- after that, a normal save may be charged
- if a user adds a place from Connect / "Shared with me", that add can be treated as an accepted recommendation
- the person who recommended/shared the place can get a small reward-back
- the user adding from recommendation can get a lower save charge than a normal save flow

### Why It Is Interesting

This can incentivize:

- sharing useful places
- adding more quality places
- community-driven discovery
- stronger network effects inside Connect

### Important Refinement

For V1, this should not start as direct cash payout.

Better future rollout:

- first test with credits / in-app wallet / reward points
- only later consider real money payout if behavior is healthy and abuse is controlled

### Reason

A real-money model too early can create:

- fake accounts
- self-sharing loops
- circular reward farming
- attribution disputes
- payout/accounting complexity

### Recommended Future Direction

Start with a softer model:

- Connect recommendation accepted -> lower save cost for receiver
- direct recommender gets credits/reward points
- repeated save of same place by same user should not re-trigger reward
- reward should only apply on first unique accepted save

### Multi-Recommender Case

If multiple users recommended the same canonical place, reward attribution becomes tricky.

Possible future models:

1. direct sharer gets full credit
2. direct sharer gets most credit, upstream recommenders get smaller share
3. reward pool split across eligible recommenders

Recommended future starting point:

- keep attribution simple
- direct sharer gets the reward

### Why This Could Become a Moat

This turns Wandreel from only a save tool into:

- a place curation network
- a recommendation economy
- a community discovery graph

The analogy discussed was closer to a Medium-like reward model, but for useful place discovery rather than writing.

### Product Rule

Keep this as a separate future idea bucket for now.

Do not mix it into the current extraction sprint unless the team explicitly chooses to scope Connect economy work.
