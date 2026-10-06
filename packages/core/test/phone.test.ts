import { describe, expect, it } from 'vitest';
import { toE164 } from '../src/index.js';

describe('toE164', () => {
  it.each([
    // Benin: legacy 8-digit and new 10-digit numbers (the leading 01 is part of the number)
    ['61000000', 'BJ', '+22961000000'],
    ['61 00 00 00', 'BJ', '+22961000000'],
    ['01 59 52 12 11', 'BJ', '+2290159521211'],
    ['0022961000000', 'BJ', '+22961000000'],
    ['+229 61 00 00 00', 'BJ', '+22961000000'],
    // Côte d'Ivoire: the leading 0 is part of the 10-digit number
    ['07 07 07 07 07', 'CI', '+2250707070707'],
    // Nigeria: the leading 0 is a trunk prefix
    ['0803 123 4567', 'NG', '+2348031234567'],
    ['(0803) 123-4567', 'NG', '+2348031234567'],
    // Already international: kept, whatever the country
    ['+221 77 000 00 00', 'BJ', '+221770000000'],
  ])('%s (%s) → %s', (input, country, expected) => {
    expect(toE164(input, country)).toBe(expected);
  });

  it.each([
    ['abc', 'BJ'],
    ['12', 'BJ'],
    ['61000000', 'XX'],
    ['+0123456789', 'BJ'],
  ])('rejects %s (%s)', (input, country) => {
    expect(() => toE164(input, country)).toThrow(
      expect.objectContaining({ code: 'INVALID_PHONE' }),
    );
  });
});
