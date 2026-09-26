import { describe, expect, it } from 'vitest';
import {
  canTransition,
  currencyExponent,
  fromMajor,
  isTerminal,
  money,
  PayenvError,
} from '../src/index.js';

describe('money', () => {
  it('knows currency exponents', () => {
    expect(currencyExponent('XOF')).toBe(0);
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('TND')).toBe(3);
  });

  it('converts major units without floating-point errors', () => {
    expect(fromMajor('5000', 'XOF')).toEqual({ value: 5000, currency: 'XOF' });
    expect(fromMajor('12.5', 'EUR')).toEqual({ value: 1250, currency: 'EUR' });
    expect(fromMajor('0.29', 'EUR')).toEqual({ value: 29, currency: 'EUR' });
  });

  it('rejects too many decimals, invalid currencies, and non-positive amounts', () => {
    expect(() => fromMajor('10.5', 'XOF')).toThrow(PayenvError);
    expect(() => money(100, 'xof')).toThrow(PayenvError);
    expect(() => money(0, 'XOF')).toThrow(PayenvError);
    expect(() => money(-5, 'XOF')).toThrow(PayenvError);
  });
});

describe('status', () => {
  it('identifies terminal statuses', () => {
    expect(isTerminal('succeeded')).toBe(true);
    expect(isTerminal('pending')).toBe(false);
    expect(isTerminal('unknown')).toBe(false);
  });

  it('never leaves a terminal status', () => {
    expect(canTransition('succeeded', 'failed')).toBe(false);
    expect(canTransition('failed', 'succeeded')).toBe(false);
    expect(canTransition('pending', 'succeeded')).toBe(true);
    expect(canTransition('unknown', 'succeeded')).toBe(true);
  });
});

describe('errors', () => {
  it('assigns default retry classes and allows overrides', () => {
    expect(new PayenvError('TIMEOUT', 'x').retryClass).toBe('ambiguous');
    expect(new PayenvError('PROVIDER_UNAVAILABLE', 'x').retryClass).toBe('safe_to_fallback');
    expect(new PayenvError('INSUFFICIENT_FUNDS', 'x').retryClass).toBe('do_not_retry');
    expect(new PayenvError('TIMEOUT', 'x', { retryClass: 'safe_to_fallback' }).retryClass).toBe(
      'safe_to_fallback',
    );
  });

  it('does not serialize the raw provider payload', () => {
    const error = new PayenvError('UNKNOWN_ERROR', 'x', { raw: { secret: 'sk_live' } });
    expect(JSON.stringify(error)).not.toContain('sk_live');
  });
});
