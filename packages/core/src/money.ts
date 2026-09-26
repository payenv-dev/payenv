import { PayenvError } from './errors.js';

/** ISO 4217 alphabetic currency code, e.g. `XOF`, `EUR`, `NGN`. */
export type CurrencyCode = string;

/**
 * An amount of money, always an integer in the currency's minor unit.
 *
 * - `{ value: 5000, currency: 'XOF' }` → 5000 FCFA (XOF has no minor unit)
 * - `{ value: 1250, currency: 'EUR' }` → €12.50
 */
export interface Money {
  readonly value: number;
  readonly currency: CurrencyCode;
}

/** ISO 4217 currencies whose minor unit exponent is 0. */
const ZERO_DECIMAL = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

/** ISO 4217 currencies whose minor unit exponent is 3. */
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

const CURRENCY_FORMAT = /^[A-Z]{3}$/;

/** Number of decimal digits of the currency's minor unit (ISO 4217 exponent). */
export function currencyExponent(currency: CurrencyCode): number {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

/** Validates and returns a {@link Money} value. Throws `INVALID_REQUEST` if invalid. */
export function money(value: number, currency: CurrencyCode): Money {
  assertValidMoney({ value, currency });
  return { value, currency };
}

export function assertValidMoney(amount: Money): void {
  if (!CURRENCY_FORMAT.test(amount.currency)) {
    throw new PayenvError(
      'INVALID_REQUEST',
      `Invalid currency code "${amount.currency}" (expected ISO 4217, e.g. "XOF")`,
    );
  }
  if (!Number.isSafeInteger(amount.value)) {
    throw new PayenvError(
      'INVALID_REQUEST',
      `Amount must be an integer in the currency's minor unit, got ${amount.value}`,
    );
  }
  if (amount.value <= 0) {
    throw new PayenvError('INVALID_REQUEST', `Amount must be positive, got ${amount.value}`);
  }
}

/**
 * Converts a major-unit decimal string (e.g. `"12.50"`) to minor units without
 * floating-point arithmetic.
 */
export function fromMajor(major: string, currency: CurrencyCode): Money {
  const exponent = currencyExponent(currency);
  const match = /^(\d+)(?:\.(\d+))?$/.exec(major.trim());
  if (!match) {
    throw new PayenvError('INVALID_REQUEST', `Invalid amount "${major}"`);
  }
  const [, whole = '0', fraction = ''] = match;
  if (fraction.length > exponent) {
    throw new PayenvError(
      'INVALID_REQUEST',
      `${currency} allows at most ${exponent} decimal(s), got "${major}"`,
    );
  }
  const value = Number(whole + fraction.padEnd(exponent, '0'));
  return money(value, currency);
}
