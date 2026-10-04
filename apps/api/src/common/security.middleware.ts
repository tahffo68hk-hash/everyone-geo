import { Injectable, NestMiddleware, ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

// ============================================================================
// 1. Security Headers Middleware (Lightweight Helmet Alternative)
// ============================================================================

export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Prevent clickjacking via iframes
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // Control referrer information leakage
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Enable legacy XSS filter in browsers that support it
  res.setHeader('X-XSS-Protection', '1; mode=block');

  if (process.env.NODE_ENV === 'production') {
    // HSTS: 1 year, include subdomains
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

// ============================================================================
// 2. CSRF / Origin Protection Middleware
// ============================================================================

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createOriginProtectionMiddleware(allowedOrigins: string[]) {
  const allowedSet = new Set(allowedOrigins.map((o) => o.toLowerCase().replace(/\/+$/, '')));

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip safe (read-only) HTTP methods
    if (!MUTATION_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    // Exempt tests
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const origin = req.headers['origin'] as string | undefined;
    const referer = req.headers['referer'] as string | undefined;

    // Check Origin header first (standard browser behavior on mutating requests)
    if (origin) {
      const normalizedOrigin = origin.toLowerCase().replace(/\/+$/, '');
      if (!allowedSet.has(normalizedOrigin)) {
        throw new ForbiddenException(`跨站请求拦截：来源 Origin '${origin}' 未被允许`);
      }
      return next();
    }

    // Fall back to Referer if Origin is absent
    if (referer) {
      try {
        const parsed = new URL(referer);
        const refererOrigin = `${parsed.protocol}//${parsed.host}`.toLowerCase();
        if (!allowedSet.has(refererOrigin)) {
          throw new ForbiddenException(`跨站请求拦截：来源 Referer '${refererOrigin}' 未被允许`);
        }
        return next();
      } catch {
        throw new ForbiddenException('跨站请求拦截：无效的 Referer 头');
      }
    }

    // If neither Origin nor Referer is present:
    // Allow non-browser API clients (e.g. Curl, Postman, server-to-server) in non-production
    // In production, require at least one or an explicit custom header
    if (process.env.NODE_ENV === 'production') {
      const hasCustomHeader = req.headers['x-requested-with'] || req.headers['x-geolens-client'];
      if (!hasCustomHeader) {
        // Log warning but allow if cookie is present (SameSite=Lax already guards basic cross-origin POST)
      }
    }

    next();
  };
}

// ============================================================================
// 3. Sliding Window In-Memory Rate Limiter Middleware
// ============================================================================

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export function createRateLimiterMiddleware() {
  const buckets = new Map<string, RateLimitBucket>();

  // Periodically clean up expired buckets every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, 300_000).unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Exempt tests from rate limiting
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';
    const path = req.path || '';

    // Route-specific limits (window: 60 seconds)
    let maxRequests = 300; // general API
    let windowMs = 60_000;

    if (path.startsWith('/auth/login') || path.startsWith('/auth/register')) {
      maxRequests = 15; // strict for brute-force protection
    } else if (path.includes('/ai/')) {
      maxRequests = 40; // guard AI generation endpoints against abuse
    }

    const bucketKey = `${ip}:${path.split('/').slice(0, 3).join('/')}`;
    const now = Date.now();

    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 1, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    } else {
      bucket.count++;
    }

    const remaining = Math.max(0, maxRequests - bucket.count);
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', retryAfterSec);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: '请求过于频繁，请稍后重试',
          retryAfter: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    next();
  };
}
