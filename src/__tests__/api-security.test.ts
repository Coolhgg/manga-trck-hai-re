import { NextRequest } from 'next/server';
import { validateOrigin, ApiError } from '@/lib/api-utils';

describe('API Security - validateOrigin', () => {
  const host = 'kenmei.com';

  const createRequest = (origin?: string) => {
    const headers = new Headers();
    if (origin) headers.set('origin', origin);
    headers.set('host', host);
    
    return {
      headers,
      url: `https://${host}/api/test`,
    } as unknown as NextRequest;
  };

  it('should allow request with same origin', () => {
    const req = createRequest(`https://${host}`);
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('should allow request with no origin (e.g. server-to-server or direct)', () => {
    const req = createRequest();
    expect(() => validateOrigin(req)).not.toThrow();
  });

  it('should throw ApiError for mismatched origin', () => {
    const req = createRequest('https://malicious-site.com');
    expect(() => validateOrigin(req)).toThrow(ApiError);
    try {
      validateOrigin(req);
    } catch (e: any) {
      expect(e.statusCode).toBe(403);
      expect(e.message).toContain('CSRF Protection: Invalid origin');
    }
  });

  it('should throw ApiError for malformed origin', () => {
    const req = createRequest('not-a-url');
    expect(() => validateOrigin(req)).toThrow(ApiError);
    try {
      validateOrigin(req);
    } catch (e: any) {
      expect(e.statusCode).toBe(403);
      expect(e.message).toContain('CSRF Protection: Invalid origin format');
    }
  });
});
