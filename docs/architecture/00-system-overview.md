# Wandreel System Overview

This document describes Wandreel as a platform, not just a set of screens or isolated features. The goal is to establish a shared mental model for how the system should evolve as more intelligence, planning, and social capabilities are added.

# System Vision

Wandreel turns short-form travel content and user intent into structured travel opportunities.

At a high level, the system should:

- extract places and travel signals from reels, links, and future content sources
- understand what a user saves, values, and is likely to act on
- detect the most useful opportunity at a given moment
- turn that opportunity into one or more product surfaces
- help the user move from inspiration to planning and action

The long-term goal is not simply to help users save content. It is to help them discover, organize, decide, and execute.

# Engine Model

Wandreel is easiest to reason about as a set of cooperating engines.

## 1. Extraction Engine

Purpose:

- convert raw external content into structured data
- identify places, entities, categories, confidence, and evidence

Inputs:

- Instagram reels
- YouTube links
- TikTok or other future content sources
- metadata, OCR, transcript, captions, visual fallbacks

Outputs:

- structured places
- categories
- evidence
- candidate place matches

Primary consumer surfaces:

- Add flow
- future ingestion pipelines
- admin observability

## 2. Personalization Engine

Purpose:

- build a model of user preferences and behavior over time

Inputs:

- saved places
- category patterns
- city patterns
- future behavior signals such as opens, taps, planner usage, repeats

Outputs:

- inferred preferences
- user affinity summaries
- structured signals for downstream engines

Primary consumer surfaces:

- Hero Card
- Planner
- Discovery
- Recommendations

## 3. Opportunity Engine

Purpose:

- decide the most valuable action or insight to surface right now

Inputs:

- saved-place state
- personalization signals
- context signals
- future freshness and recency signals

Outputs:

- ranked or selected opportunities
- action suggestions
- structured CTA metadata

Primary consumer surfaces:

- Hero Card
- future planner prompts
- future discovery prompts

Hero Card should be treated as the first consumer of this engine, not the owner of opportunity logic.

## 4. Recommendation Engine

Purpose:

- retrieve and rank relevant places, routes, or travel experiences

Inputs:

- user intent
- personalization signals
- planner context
- geographic and category context

Outputs:

- recommended places
- ranked candidate experiences
- discoverable options beyond existing saved content

Primary consumer surfaces:

- Discovery
- Planner
- Hero Card in later phases

## 5. Planning Engine

Purpose:

- transform saved places and recommendations into itineraries or executable plans

Inputs:

- saved places
- user destination and timing
- ranked recommendations
- future trip constraints

Outputs:

- itinerary candidates
- clustered routes
- suggested day plans

Primary consumer surfaces:

- future planner UI
- future itinerary CTAs from Hero Card

## 6. Social Engine

Purpose:

- power sharing, recommendations between people, and future collaboration

Inputs:

- global/shared saved places
- sharing actions
- future social graph or group planning signals

Outputs:

- social recommendations
- collaborative opportunities
- trust-weighted discovery signals

Primary consumer surfaces:

- Connect
- shared places
- future group planning

# How Hero Card Fits

Hero Card is not the personalization engine and should not become the place where global personalization rules accumulate.

Hero Card is a UI surface that asks:

> Given what we currently know about this user, what is the single best thing to show right now?

That question belongs to the Opportunity Engine.

Current state:

- Hero Card already behaves like an Opportunity Engine consumer
- its data source is currently saved places plus heuristic scoring
- its output is one structured insight and one CTA

Future state:

- the Opportunity Engine should produce ranked opportunities
- Hero Card should render one of them
- other surfaces such as Planner or Discovery should consume the same underlying opportunity model differently

# High-Level Data Flow

Current and intended data flow can be summarized like this:

```text
Raw Content / Links
        |
        v
Extraction Engine
        |
        v
Structured Places + Evidence
        |
        v
Saved Places / User State
        |
        +----------------------+
        |                      |
        v                      v
Personalization Engine   Context Signals
        |                      |
        +----------+-----------+
                   |
                   v
          Opportunity Engine
                   |
       +-----------+-----------+
       |           |           |
       v           v           v
   Hero Card    Planner    Discovery
                   |
                   v
         Recommendation Engine
                   |
                   v
             Executable Plans
```

# Current Status

Today, the platform is unevenly mature:

- Extraction Engine: implemented and actively used
- Hero Card / Opportunity-style logic: partially implemented via heuristics
- Personalization Engine: still implicit, mostly derived from saved-place structure
- Recommendation Engine: conceptual, not yet separated as a subsystem
- Planning Engine: mostly future state
- Social Engine: partial via Connect and global/shared places

This is acceptable. The purpose of this document structure is to make the target system legible before every engine is fully built.

# Ownership Model

Each major subsystem should eventually have:

- one architecture document
- one or more ADRs when a major decision is made
- one API contract document if externally consumed
- clear separation between product intent and technical implementation

The rest of the `docs/architecture` directory should be read as subsystem-specific elaborations on this overview.

