# Smoke Tests

## Domain + PWA

- [ ] `https://wandreel.com` opens without cert warnings.
- [ ] Add-to-home-screen works on mobile.
- [ ] Installed PWA launches correctly and splash behavior is intact.

## Core API

- [ ] Metadata extraction
```bash
curl -X POST https://api.wandreel.com/api/metadata/extract \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","mode":"quick"}'
```

- [ ] Intelligence sync
```bash
curl -X POST https://api.wandreel.com/api/intelligence/extract \
  -H "content-type: application/json" \
  -d '{"mode":"sync","source":{"url":"https://example.com","platform":"youtube","title":"Sample","description":"Patna places","transcript":"Eco Park boating","hashtags":[],"thumbnail":null}}'
```

- [ ] Intelligence async + job fetch
```bash
curl -X POST https://api.wandreel.com/api/intelligence/extract \
  -H "content-type: application/json" \
  -d '{"mode":"async","source":{"url":"https://example.com","platform":"youtube","title":"Sample","description":"Patna places","transcript":"Eco Park boating","hashtags":[],"thumbnail":null}}'
```
Then fetch `GET /api/intelligence/jobs/:jobId`.

## Functional checks

- [ ] Multi-category entity extraction works (`eat/do/stay/see` when present).
- [ ] Weak mentions are populated for vague references.
- [ ] No recipe/movie entities emitted.

## Reliability checks

- [ ] No CORS errors in browser console.
- [ ] No cookie/domain mismatch warnings.
- [ ] 5xx rate is within expected threshold.
