import type express from "express";

type AuthenticatedRequest = express.Request & {
  authUser?: {
    userId: string;
  };
};

export type RateLimitOptions = {
  windowMs: number;
  max: number;
  keyPrefix: string;
};

type Bucket = {
  windowStartMs: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

function requestKey(req: express.Request, keyPrefix: string) {
  const authUserId = (req as AuthenticatedRequest).authUser?.userId;
  return `${keyPrefix}:${authUserId || req.ip || "anonymous"}`;
}

export function createInMemoryRateLimit(options: RateLimitOptions): express.RequestHandler {
  return (req, res, next) => {
    const now = Date.now();
    const key = requestKey(req, options.keyPrefix);
    const bucket = buckets.get(key);
    const current =
      bucket && now - bucket.windowStartMs < options.windowMs
        ? bucket
        : { windowStartMs: now, count: 0 };
    current.count += 1;
    buckets.set(key, current);

    if (current.count > options.max) {
      const retryAfterMs = Math.max(0, options.windowMs - (now - current.windowStartMs));
      res.setHeader("Retry-After", String(Math.ceil(retryAfterMs / 1000)));
      return res.status(429).json({
        ok: false,
        error: "Too many requests",
        code: "rate_limited",
      });
    }

    return next();
  };
}

export function clearRateLimitBuckets() {
  buckets.clear();
}
