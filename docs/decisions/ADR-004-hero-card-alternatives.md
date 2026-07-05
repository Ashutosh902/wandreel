# ADR-004: Why Hero Card Returns Ordered Alternatives

# Status

Accepted

# Context

Hero Card V2 introduced internal candidate scoring on the backend, but the API still returned only the single top card.

Freshness V1 then added a 24-hour client-side cooldown for exact repeat cards. That improved repetition, but introduced a bad side effect:

- if the top card was suppressed, the Hero Card disappeared completely

At that point the system already had a scored internal candidate list, but the client had no access to it.

# Decision

The Hero Card API will remain backward compatible while adding:

- a stable `cardKey` for the selected card
- an `alternatives` array containing up to 3 scored candidates after the selected card

The frontend will:

- apply the same 24-hour cooldown
- try the selected card first
- fall through to alternatives in score order
- hide the Hero Card only if every returned candidate is suppressed

# Alternatives Considered

## Keep returning only the top card

Rejected because:

- freshness would continue to create empty hero states
- the backend already had useful alternative candidates available

## Return the full internal candidate list

Rejected for now because:

- it exposes more internal scoring detail than the client currently needs
- it creates a larger API surface too early
- it may imply a stable public candidate-debug contract before we want one

## Randomize on the backend

Rejected for now because:

- we do not yet track what the client actually showed
- backend randomization would be harder to reason about and test
- deterministic score order is better for early debugging

# Why This Approach Was Chosen

- minimal change to the API
- backward compatible for existing clients
- enough to support freshness fallback and near-term rotation
- keeps the backend deterministic
- keeps PWA and Capacitor-safe client behavior unchanged outside hero selection

# Consequences

Positive:

- the Hero Card can survive cooldown without disappearing immediately
- the backend now owns stable hero identity through `cardKey`
- future rotation work has a clean starting point

Tradeoffs:

- the client still does some freshness decision-making
- only the top few alternatives are available
- this is not yet full rotation, dismissal, or exposure tracking

# Follow-up

Likely next steps:

- decide whether alternatives should rotate beyond pure score order
- add dismiss support using existing localStorage shape
- consider backend exposure tracking if cross-device freshness becomes important
