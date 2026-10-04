import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  securityHeadersMiddleware,
  createOriginProtectionMiddleware,
  createRateLimiterMiddleware,
} from '../src/common/security.middleware';

describe('Security Hardening E2E Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(securityHeadersMiddleware);
    app.use(createOriginProtectionMiddleware(['http://localhost:3000', 'https://geolens.internal']));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('HTTP Security Headers', () => {
    it('should set X-Content-Type-Options: nosniff', async () => {
      const res = await request(app.getHttpServer()).get('/ai/status');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should set X-Frame-Options: SAMEORIGIN', async () => {
      const res = await request(app.getHttpServer()).get('/ai/status');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    });

    it('should set Referrer-Policy', async () => {
      const res = await request(app.getHttpServer()).get('/ai/status');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    });

    it('should set X-XSS-Protection', async () => {
      const res = await request(app.getHttpServer()).get('/ai/status');
      expect(res.headers['x-xss-protection']).toBe('1; mode=block');
    });
  });

  describe('CSRF / Origin Protection (Non-test simulation)', () => {
    it('createOriginProtectionMiddleware blocks unauthorized origin', () => {
      const middleware = createOriginProtectionMiddleware(['http://localhost:3000']);
      const req = {
        method: 'POST',
        headers: { origin: 'https://evil-attacker.com' },
      } as any;
      const res = {} as any;
      const next = jest.fn();

      // Temporarily override NODE_ENV to trigger origin check
      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => middleware(req, res, next)).toThrow('跨站请求拦截');
        expect(next).not.toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('createOriginProtectionMiddleware allows whitelisted origin', () => {
      const middleware = createOriginProtectionMiddleware(['http://localhost:3000']);
      const req = {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      } as any;
      const res = {} as any;
      const next = jest.fn();

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        middleware(req, res, next);
        expect(next).toHaveBeenCalled();
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });

    it('createOriginProtectionMiddleware allows safe GET methods regardless of origin', () => {
      const middleware = createOriginProtectionMiddleware(['http://localhost:3000']);
      const req = {
        method: 'GET',
        headers: { origin: 'https://evil-attacker.com' },
      } as any;
      const res = {} as any;
      const next = jest.fn();

      middleware(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Rate Limiter Behavior', () => {
    it('createRateLimiterMiddleware tracks requests and limits after threshold', () => {
      const limiter = createRateLimiterMiddleware();
      const req = {
        path: '/auth/login',
        headers: {},
        socket: { remoteAddress: '192.168.1.100' },
      } as any;
      const res = {
        setHeader: jest.fn(),
      } as any;
      const next = jest.fn();

      const origEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        // Send 15 requests (within limit)
        for (let i = 0; i < 15; i++) {
          limiter(req, res, next);
        }
        expect(next).toHaveBeenCalledTimes(15);

        // 16th request should be throttled
        expect(() => limiter(req, res, next)).toThrow();
      } finally {
        process.env.NODE_ENV = origEnv;
      }
    });
  });
});
