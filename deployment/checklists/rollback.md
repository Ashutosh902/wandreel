# Rollback Checklist

## Trigger conditions

- Sustained critical error rate (>5% 5xx for 10+ min)
- Core flows broken (home load, extraction API, intelligence API)
- Security/certificate misconfiguration

## Rollback steps

1. Repoint Pages domain to last known good deployment.
2. Revert API origin route/DNS to last stable backend.
3. Purge Cloudflare cache.
4. Validate health endpoints and core flows.
5. Post incident update with root cause and follow-up actions.

## Data safety

- Keep write paths idempotent where possible.
- If any partial writes occurred, run reconciliation job before re-enable.

## Ownership

- Incident commander: _TBD_
- DNS owner: _TBD_
- API owner: _TBD_
- UI owner: _TBD_
