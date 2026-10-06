import { PayenvError } from './errors.js';
import type { CountryCode } from './method.js';

/** Country calling codes (ITU-T E.164) for the countries Payenv connectors serve first. */
const CALLING_CODES: Readonly<Record<CountryCode, string>> = {
  BF: '226',
  BJ: '229',
  CD: '243',
  CG: '242',
  CI: '225',
  CM: '237',
  FR: '33',
  GA: '241',
  GH: '233',
  GN: '224',
  KE: '254',
  ML: '223',
  NE: '227',
  NG: '234',
  RW: '250',
  SN: '221',
  TD: '235',
  TG: '228',
  TZ: '255',
  UG: '256',
  ZM: '260',
};

/**
 * Countries where a leading 0 is a national trunk prefix, dropped in E.164
 * (e.g. Nigeria 0803… → +234803…). In Benin and Côte d'Ivoire, the leading 0 of
 * 10-digit numbers is part of the number (+22901…, +22507…).
 */
const TRUNK_ZERO: ReadonlySet<CountryCode> = new Set([
  'CD',
  'FR',
  'GH',
  'KE',
  'NG',
  'RW',
  'TZ',
  'UG',
  'ZM',
]);

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Converts a phone number typed by a customer into E.164, for a given country.
 *
 * ```ts
 * toE164('61 00 00 00', 'BJ');     // '+22961000000'
 * toE164('0022961000000', 'BJ');   // '+22961000000'
 * toE164('0803 123 4567', 'NG');   // '+2348031234567'
 * ```
 *
 * Numbers that already start with `+` (or `00`) are kept as they are. Throws
 * `INVALID_PHONE` when the result is not a valid E.164 number, or the country is unknown.
 * Payenv itself only accepts E.164: call this before `collect` with what the user typed.
 */
export function toE164(phone: string, country: CountryCode): string {
  const compact = phone.replace(/[\s.\-()]/g, '');
  const international = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;

  if (international.startsWith('+')) return assertE164(international, phone);

  const callingCode = CALLING_CODES[country];
  if (!callingCode) {
    throw new PayenvError(
      'INVALID_PHONE',
      `Unknown calling code for country "${country}": pass the number in E.164 (+…)`,
    );
  }
  if (!/^\d+$/.test(international)) {
    throw new PayenvError('INVALID_PHONE', `Invalid phone number "${phone}"`);
  }
  const national =
    TRUNK_ZERO.has(country) && international.startsWith('0')
      ? international.slice(1)
      : international;
  return assertE164(`+${callingCode}${national}`, phone);
}

function assertE164(candidate: string, input: string): string {
  if (!E164.test(candidate)) {
    throw new PayenvError('INVALID_PHONE', `Invalid phone number "${input}"`);
  }
  return candidate;
}
