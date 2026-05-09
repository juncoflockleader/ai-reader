import type express from "express";

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type RateLimitOptions = {
  windowMs: number;
  max: number;
  name: string;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export function createSecurityHeadersMiddleware(enabled: boolean): express.RequestHandler {
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (enabled) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
    }
    next();
  };
}

export function createRateLimitMiddleware(enabled: boolean, options: RateLimitOptions): express.RequestHandler {
  const buckets = new Map<string, RateLimitEntry>();

  return (req, res, next) => {
    if (!enabled) {
      next();
      return;
    }

    const now = Date.now();
    const key = `${options.name}:${req.ip || req.socket.remoteAddress || "unknown"}`;
    const current = buckets.get(key);
    const entry = current && current.resetAt > now ? current : { count: 0, resetAt: now + options.windowMs };
    entry.count += 1;
    buckets.set(key, entry);
    pruneExpiredBuckets(buckets, now);

    const remaining = Math.max(0, options.max - entry.count);
    res.setHeader("RateLimit-Limit", String(options.max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests. Please wait and try again." });
      return;
    }

    next();
  };
}

export function limitMethods(methods: string[], middleware: express.RequestHandler): express.RequestHandler {
  const limitedMethods = new Set(methods.map((method) => method.toUpperCase()));
  return (req, res, next) => {
    if (!limitedMethods.has(req.method.toUpperCase())) {
      next();
      return;
    }
    middleware(req, res, next);
  };
}

export function createOriginCheckMiddleware(enabled: boolean): express.RequestHandler {
  return (req, res, next) => {
    if (!enabled || !unsafeMethods.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const requestHost = normalizedHost(req.get("x-forwarded-host") ?? req.get("host"));
    const originHost = normalizedUrlHost(req.get("origin"));
    const refererHost = normalizedUrlHost(req.get("referer"));
    if ((originHost && originHost !== requestHost) || (refererHost && refererHost !== requestHost)) {
      res.status(403).json({ error: "Rejected cross-origin request." });
      return;
    }

    next();
  };
}

function normalizedUrlHost(value: string | undefined) {
  if (!value) return null;
  try {
    return normalizedHost(new URL(value).host);
  } catch {
    return null;
  }
}

function normalizedHost(value: string | undefined) {
  return value?.trim().toLowerCase() ?? null;
}

function pruneExpiredBuckets(buckets: Map<string, RateLimitEntry>, now: number) {
  if (buckets.size < 1000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}
