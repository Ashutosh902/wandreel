# Extraction Pipeline

Owner subsystem:

- Extraction Engine

# Purpose

The Extraction Pipeline converts raw input content into structured travel/place data that the rest of Wandreel can use.

# Current Status

Implemented and actively used.

The pipeline currently supports:

- metadata extraction
- transcript attempts
- OCR
- visual fallback
- structured entity generation
- observability and attempt tracking

This is one of the most mature engines in the current platform.

# Current Responsibilities

- ingest submitted links and content
- identify candidate places
- collect evidence from multiple extraction paths
- emit structured output for downstream save and intelligence flows

# Future Direction

- stronger quality scoring
- source-specific specialization
- faster low-cost paths for common cases
- better confidence propagation into downstream personalization and recommendation systems

# Key Questions

- how should extraction confidence affect downstream personalization?
- when should extraction be retried versus accepted?
- what canonical data contract should every downstream engine rely on?

