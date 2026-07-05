# Data Model

Owner subsystem:

- Shared platform architecture

# Purpose

This document should describe the core entities Wandreel uses across extraction, saved places, personalization, planning, and social flows.

# Current Status

Partially documented elsewhere, not yet centralized in this architecture series.

Important current entities already exist in code and schema, including:

- users
- auth sessions
- saved places
- extraction outputs
- intelligence outputs
- analytics attempts and runs

# Current Responsibilities

- provide a common language for backend and frontend development
- define stable contracts between engines

# Future Direction

- unify terminology around places, entities, opportunities, plans, and social objects
- document canonical versus derived data
- clarify which signals are durable versus computed

# Key Questions

- what is the canonical “place” object across subsystems?
- what is the canonical “opportunity” object once Opportunity Engine matures?
- where should derived personalization state live?

