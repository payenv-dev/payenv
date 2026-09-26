/** ISO 3166-1 alpha-2 country code, e.g. `BJ`, `CI`, `SN`. */
export type CountryCode = string;

/**
 * Payenv's own, stable mobile money network identifiers. Connectors map them to
 * their provider's slugs (e.g. FedaPay uses `mtn_open` for MTN collections).
 * Other identifiers are accepted, so new networks don't require a core release.
 */
export type MobileMoneyNetwork =
  | 'mtn'
  | 'moov'
  | 'orange'
  | 'wave'
  | 'celtiis'
  | 'free'
  | 'airtel'
  | 'mpesa'
  | 'togocom'
  | (string & {});

export interface MobileMoneyMethod {
  type: 'mobile_money';
  network: MobileMoneyNetwork;
  country: CountryCode;
  /** E.164 phone number, e.g. `+22990000000`. */
  phone: string;
}

export interface CardMethod {
  type: 'card';
  /** Token from the provider's hosted fields. Payenv never handles raw card numbers. */
  token: string;
  country?: CountryCode;
}

export interface HostedPageMethod {
  type: 'hosted_page';
  /** Where the provider sends the customer back after checkout. */
  returnUrl: string;
  country?: CountryCode;
}

export type PaymentMethod = MobileMoneyMethod | CardMethod | HostedPageMethod;

export type PaymentMethodType = PaymentMethod['type'];

export function methodCountry(method: PaymentMethod): CountryCode | undefined {
  return method.country;
}

export function methodNetwork(method: PaymentMethod): MobileMoneyNetwork | undefined {
  return method.type === 'mobile_money' ? method.network : undefined;
}
