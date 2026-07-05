# Trip Planner

Owner subsystem:

- Planning Engine

# Purpose

The Trip Planner should turn saved places and recommendations into itineraries, routes, and actionable trip structures.

# Current Status

Mostly future-facing.

The only current planner-adjacent behavior is Hero Card’s `itinerary_ready` opportunity, which currently resolves to placeholder behavior rather than a full planner flow.

# Current Responsibilities

- no dedicated planner engine or planner route yet

# Future Direction

- itinerary generation
- route clustering
- day-plan composition
- trip scoping by city, duration, budget, or intent

# Key Questions

- should the planner consume only saved places first?
- when should recommendations be introduced into plan building?
- how should user edits reshape future planning suggestions?

