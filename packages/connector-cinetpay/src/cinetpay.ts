import {
  type Capability,
  type Connector,
  type CountryCode,
  type CurrencyCode,
  type MobileMoneyNetwork,
  type NextAction,
  type Operation,
  PayenvError,
  type PayenvErrorCode,
  type PaymentStatus,
  type ProviderResult,
  type RetryClass,
  type StatusResult,
} from '@payenv/core';

export type CinetPayEnvironment = 'sandbox' | 'live';

/** API credentials of one CinetPay country account. */
export interface CinetPayCredentials {
  /** `sk_test_…` in the sandbox, `sk_live_…` in production. */
  apiKey: string;
  apiPassword: string;
}

/** CinetPay `payment_method` codes, per country and Payenv network. */
export type CinetPayMethods = Readonly<
  Record<CountryCode, Readonly<Partial<Record<MobileMoneyNetwork, string>>>>
>;

/**
 * Networks served by a direct push (no redirection), from the official SDK's operator
 * table. Orange Money (OTP code) and Wave (app or QR code) are left out: they need the
 * customer on CinetPay's page. Add them with the `methods` option once verified.
 */
export const DEFAULT_METHODS: CinetPayMethods = {
  BJ: { mtn: 'MTN_BJ', moov: 'MOOV_BJ' },
  BF: { moov: 'MOOV_BF' },
  CI: { mtn: 'MTN_CI', moov: 'MOOV_CI' },
  CM: { mtn: 'MTN_CM' },
  GN: { mtn: 'MTN_GN' },
  ML: { moov: 'MOOV_ML' },
  NE: { airtel: 'AIRTEL_NE', moov: 'MOOV_NE' },
  SN: { free: 'FREE_SN' },
  TG: { moov: 'MOOV_TG', togocom: 'TMONEY_TG' },
};

/**
 * Networks paid out by transfer (`POST /v1/transfer`), from the official SDK's operator
 * table. A transfer needs nothing from the recipient, so Orange Money and Wave are
 * included. Expresso (Senegal) and Zamani (Niger) have no Payenv network yet: add them
 * with the `payoutMethods` option.
 */
export const DEFAULT_PAYOUT_METHODS: CinetPayMethods = {
  BJ: { mtn: 'MTN_BJ', moov: 'MOOV_BJ' },
  BF: { orange: 'OM_BF', moov: 'MOOV_BF', wave: 'WAVE_BF' },
  CI: { orange: 'OM_CI', mtn: 'MTN_CI', moov: 'MOOV_CI', wave: 'WAVE_CI' },
  CM: { orange: 'OM_CM', mtn: 'MTN_CM' },
  GN: { orange: 'OM_GN', mtn: 'MTN_GN' },
  ML: { orange: 'OM_ML', moov: 'MOOV_ML' },
  NE: { airtel: 'AIRTEL_NE', moov: 'MOOV_NE' },
  SN: { orange: 'OM_SN', free: 'FREE_SN', wave: 'WAVE_SN' },
  TG: { moov: 'MOOV_TG', togocom: 'TMONEY_TG' },
};

/**
 * Currency of each CinetPay country. Only currencies without a minor unit are listed:
 * CinetPay amounts are whole numbers (RD Congo's CDF and USD are not supported yet).
 */
export const COUNTRY_CURRENCIES: Readonly<Record<CountryCode, CurrencyCode>> = {
  BJ: 'XOF',
  BF: 'XOF',
  CI: 'XOF',
  ML: 'XOF',
  NE: 'XOF',
  SN: 'XOF',
  TG: 'XOF',
  CM: 'XAF',
  GN: 'GNF',
};

/** Amount limits of a CinetPay payment (official SDK validation). */
export const MIN_AMOUNT = 100;
export const MAX_AMOUNT = 2_500_000;

/** Amount limits of a CinetPay transfer (official SDK validation). */
export const MIN_PAYOUT_AMOUNT = 100;
export const MAX_PAYOUT_AMOUNT = 1_500_000;

export interface CinetPayOptions {
  /**
   * Credentials per country: each CinetPay country account has its own API key and
   * password. Only these countries are exposed.
   */
  credentials: Readonly<Record<CountryCode, CinetPayCredentials>>;
  /**
   * Where CinetPay posts its notifications (at most 120 characters). A function receives
   * the payment's idempotency key, so the webhook handler knows which payment to refresh.
   */
  notifyUrl: string | ((idempotencyKey: string) => string);
  /**
   * Where CinetPay sends the customer after a direct push (required by its API, rarely
   * shown). Hosted-page payments use the request's `returnUrl`. Defaults to `notifyUrl`.
   */
  returnUrl?: string;
  /** Defaults to `sandbox`. */
  environment?: CinetPayEnvironment;
  /**
   * Networks paid by direct push, per country. Defaults to {@link DEFAULT_METHODS}.
   * Pass `{}` to only offer CinetPay's hosted page.
   */
  methods?: CinetPayMethods;
  /**
   * Networks paid out by transfer, per country. Defaults to
   * {@link DEFAULT_PAYOUT_METHODS}. Pass `{}` to disable payouts. Transfers must be
   * enabled on the CinetPay account, and are paid from its balance in that country.
   */
  payoutMethods?: CinetPayMethods;
  /** Offer CinetPay's hosted page (`hosted_page` method). Defaults to `true`. */
  hostedPage?: boolean;
  /** Language of CinetPay's pages. Defaults to `fr`. */
  lang?: 'fr' | 'en';
  /** Connector id used in routing and payments. Defaults to `cinetpay`. */
  id?: string;
  /** Custom `fetch`, e.g. for tests or proxies. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

const BASE_URLS: Record<CinetPayEnvironment, string> = {
  sandbox: 'https://api.cinetpay.net',
  live: 'https://api.cinetpay.co',
};

/** Tokens last 24 hours; renew them a little earlier. */
const TOKEN_MARGIN_MS = 60 * 60 * 1000;

/** CinetPay's numeric API codes (official SDK). */
const CODE = {
  OK: 200,
  NOT_FOUND: 404,
  INVALID_TOKEN: 1002,
  EXPIRED_TOKEN: 1003,
} as const;

export type Json = Record<string, unknown>;

/**
 * Steps of a call. Money can only move during `init` of a direct push (a hosted-page
 * payment waits for the customer on a page they have not been sent to yet) and during
 * `transfer`.
 */
type Step = 'login' | 'init' | 'transfer' | 'status';

class CinetPayApiError extends Error {
  constructor(
    readonly step: Step,
    readonly httpStatus: number,
    readonly body: Json,
  ) {
    super(
      `CinetPay ${step} failed (HTTP ${httpStatus}, ${apiStatus(body) ?? 'no status'}): ${
        providerMessage(body) ?? 'no message'
      }`,
    );
  }
}

/**
 * CinetPay connector (API v1: `api.cinetpay.net` / `api.cinetpay.co`).
 *
 * - `mobile_money`: a direct push to the customer's phone, like FedaPay.
 * - `hosted_page`: the customer is redirected to CinetPay's page (`redirect` next action)
 *   and chooses how to pay there (Orange Money, Wave, cards…).
 * - Payouts: a transfer from the merchant's CinetPay balance to a mobile money number.
 *
 * The CinetPay `merchant_transaction_id` is derived from the attempt's reference, so a
 * payment or a payout can always be looked up, even after a timeout.
 */
export function cinetpay(options: CinetPayOptions): Connector {
  const countries = Object.keys(options.credentials ?? {});
  if (countries.length === 0) {
    throw new PayenvError('INVALID_REQUEST', 'CinetPay credentials are required');
  }
  for (const country of countries) {
    const credentials = options.credentials[country];
    if (!credentials?.apiKey || !credentials.apiPassword) {
      throw new PayenvError(
        'INVALID_REQUEST',
        `CinetPay apiKey and apiPassword are required for ${country}`,
      );
    }
  }
  if (!options.notifyUrl) {
    throw new PayenvError('INVALID_REQUEST', 'CinetPay notifyUrl is required');
  }
  const id = options.id ?? 'cinetpay';
  const environment = options.environment ?? 'sandbox';
  const baseUrl = BASE_URLS[environment];
  const methods = options.methods ?? DEFAULT_METHODS;
  const payoutMethods = options.payoutMethods ?? DEFAULT_PAYOUT_METHODS;
  const doFetch = options.fetch ?? globalThis.fetch;

  const capabilities: Capability[] = [];
  for (const country of countries) {
    const currency = COUNTRY_CURRENCIES[country];
    if (currency === undefined) continue;
    const networks = Object.keys(methods[country] ?? {});
    if (networks.length > 0) {
      capabilities.push({
        operation: 'collect',
        method: 'mobile_money',
        currencies: [currency],
        countries: [country],
        networks,
      });
    }
    if (options.hostedPage !== false) {
      capabilities.push({
        operation: 'collect',
        method: 'hosted_page',
        currencies: [currency],
        countries: [country],
      });
    }
  }
  for (const country of countries) {
    const currency = COUNTRY_CURRENCIES[country];
    const networks = Object.keys(payoutMethods[country] ?? {});
    if (currency === undefined || networks.length === 0) continue;
    capabilities.push({
      operation: 'payout',
      method: 'mobile_money',
      currencies: [currency],
      countries: [country],
      networks,
    });
  }

  const notifyUrlFor = (idempotencyKey: string) =>
    typeof options.notifyUrl === 'function' ? options.notifyUrl(idempotencyKey) : options.notifyUrl;

  const tokens = new Map<CountryCode, { token: string; expiresAt: number }>();
  /** Country of each attempt started by this instance, to look it up directly. */
  const attemptCountries = new Map<string, CountryCode>();

  async function send(
    method: string,
    path: string,
    signal: AbortSignal,
    init: {
      body?: Json;
      token?: string;
    },
  ) {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (init.token) headers.Authorization = `Bearer ${init.token}`;
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      signal,
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    return { httpStatus: response.status, data: await readJson(response) };
  }

  async function login(country: CountryCode, signal: AbortSignal, renew = false) {
    const cached = tokens.get(country);
    if (!renew && cached && cached.expiresAt > Date.now()) return cached.token;
    const credentials = options.credentials[country] as CinetPayCredentials;
    const { httpStatus, data } = await send('POST', '/v1/oauth/login', signal, {
      body: { api_key: credentials.apiKey, api_password: credentials.apiPassword },
    });
    const token = data.access_token;
    if (httpStatus >= 400 || typeof token !== 'string' || token === '') {
      // The error body never contains the credentials, but don't keep it either.
      throw new CinetPayApiError('login', httpStatus, {
        code: data.code,
        status: data.status,
        description: data.description,
      });
    }
    const expiresIn = typeof data.expires_in === 'number' ? data.expires_in * 1000 : 0;
    tokens.set(country, {
      token,
      expiresAt: Date.now() + Math.max(expiresIn - TOKEN_MARGIN_MS, 0),
    });
    return token;
  }

  /** An authenticated call. A token rejected as expired is renewed once. */
  async function call(
    country: CountryCode,
    method: string,
    path: string,
    signal: AbortSignal,
    body?: Json,
  ) {
    const authenticate = async (renew: boolean) => {
      try {
        return await login(country, signal, renew);
      } catch (thrown) {
        // Nothing was sent yet: never a reason to think money moved.
        throw toError('login', false, thrown);
      }
    };
    let token = await authenticate(false);
    let response = await send(method, path, signal, { token, ...(body ? { body } : {}) });
    const code = response.data.code;
    if (code === CODE.EXPIRED_TOKEN || code === CODE.INVALID_TOKEN) {
      // Rejected before anything was processed: safe to send again.
      token = await authenticate(true);
      response = await send(method, path, signal, { token, ...(body ? { body } : {}) });
    }
    return response;
  }

  function toError(step: Step, moneyMayMove: boolean, thrown: unknown): PayenvError {
    if (thrown instanceof PayenvError) return thrown;
    if (thrown instanceof CinetPayApiError) {
      const { code, retryClass } = apiErrorCode(thrown, moneyMayMove);
      return new PayenvError(code, thrown.message, {
        connectorId: id,
        raw: thrown.body,
        ...(retryClass ? { retryClass } : {}),
        ...(apiStatus(thrown.body) ? { providerCode: apiStatus(thrown.body) } : {}),
      });
    }
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    return moneyMayMove
      ? new PayenvError('NETWORK_ERROR', `CinetPay ${step} did not complete: ${message}`, {
          connectorId: id,
          cause: thrown,
        })
      : new PayenvError('PROVIDER_UNAVAILABLE', `CinetPay unreachable (${step}): ${message}`, {
          connectorId: id,
          cause: thrown,
        });
  }

  /**
   * Looks a payment (or a transfer) up in one country. `undefined` means CinetPay has no
   * record of it.
   */
  async function lookup(
    operation: Operation,
    country: CountryCode,
    identifier: string,
    signal: AbortSignal,
  ): Promise<Json | undefined> {
    const resource = operation === 'payout' ? 'transfer' : 'payment';
    let response: { httpStatus: number; data: Json };
    try {
      response = await call(
        country,
        'GET',
        `/v1/${resource}/${encodeURIComponent(identifier)}`,
        signal,
      );
    } catch (thrown) {
      throw toError('status', false, thrown);
    }
    const { httpStatus, data } = response;
    // Only CinetPay's explicit answer counts as "not found", not a bare HTTP 404.
    if (data.code === CODE.NOT_FOUND || data.status === 'NOT_FOUND') return undefined;
    const known = operation === 'payout' ? isTransferStatus : isTransactionStatus;
    if (httpStatus >= 400 || !known(apiStatus(data))) {
      throw toError('status', false, new CinetPayApiError('status', httpStatus, data));
    }
    return data;
  }

  return {
    id,
    capabilities: () => capabilities,

    async collect(request, context): Promise<ProviderResult> {
      const { method, amount } = request;
      if (method.type === 'card') {
        throw new PayenvError('ROUTE_UNSUPPORTED', 'CinetPay connector does not take card tokens', {
          connectorId: id,
        });
      }
      const country = method.country;
      if (country === undefined || options.credentials[country] === undefined) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `CinetPay credentials not configured for ${country ?? 'this country'}`,
          { connectorId: id },
        );
      }
      const direct = method.type === 'mobile_money';
      const paymentMethod =
        method.type === 'mobile_money' ? methods[country]?.[method.network] : undefined;
      if (method.type === 'mobile_money' && paymentMethod === undefined) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `CinetPay method not configured for ${method.network} / ${country}`,
          { connectorId: id },
        );
      }
      if (amount.value < MIN_AMOUNT || amount.value > MAX_AMOUNT) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `CinetPay accepts amounts from ${MIN_AMOUNT} to ${MAX_AMOUNT}, got ${amount.value}`,
          { connectorId: id },
        );
      }
      const { customer } = request;
      if (!customer?.firstName || !customer.lastName || !customer.email) {
        // Required by CinetPay. Never made up: another provider may not need them.
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          "CinetPay requires the customer's first name, last name and email",
          { connectorId: id },
        );
      }

      const merchantReference = merchantTransactionId(context.reference);
      const notifyUrl = notifyUrlFor(request.idempotencyKey);
      const returnUrl =
        method.type === 'hosted_page' ? method.returnUrl : (options.returnUrl ?? notifyUrl);
      const body: Json = {
        currency: amount.currency,
        merchant_transaction_id: merchantReference,
        amount: amount.value,
        lang: options.lang ?? 'fr',
        designation: request.description ?? `Payment ${request.idempotencyKey}`,
        client_email: customer.email,
        client_first_name: customer.firstName,
        client_last_name: customer.lastName,
        success_url: returnUrl,
        failed_url: returnUrl,
        notify_url: notifyUrl,
        channel: 'PUSH',
      };
      if (method.type === 'mobile_money') {
        body.client_phone_number = method.phone;
        body.payment_method = paymentMethod;
        body.direct_pay = true;
      } else if (customer.phone) {
        body.client_phone_number = customer.phone;
      }
      attemptCountries.set(context.reference, country);

      // A single call: for a direct push, money may move from here on.
      let data: Json;
      try {
        const response = await call(country, 'POST', '/v1/payment', context.signal, body);
        if (response.httpStatus >= 400 || response.data.code !== CODE.OK) {
          throw new CinetPayApiError('init', response.httpStatus, response.data);
        }
        data = response.data;
      } catch (thrown) {
        // Without CinetPay's transaction id, the attempt is looked up by its reference.
        throw toError('init', direct, thrown);
      }

      const providerRef = nonEmpty(data.transaction_id);
      const paymentUrl = nonEmpty(data.payment_url);
      const details = isJson(data.details) ? data.details : {};
      const base = {
        merchantReference,
        ...(providerRef ? { providerRef } : {}),
        raw: data,
      };

      if (!direct || details.must_be_redirected === true) {
        if (!paymentUrl) {
          throw toError(
            'init',
            direct,
            new PayenvError(
              direct ? 'UNKNOWN_ERROR' : 'PROVIDER_UNAVAILABLE',
              'CinetPay returned no payment URL',
              { connectorId: id, raw: data },
            ),
          );
        }
        return {
          ...base,
          status: 'requires_action',
          nextAction: { type: 'redirect', url: paymentUrl },
        };
      }

      const { status, error } = transactionStatus(details, id);
      if (status === 'unknown') {
        return {
          ...base,
          status,
          error: new PayenvError('UNKNOWN_ERROR', 'CinetPay returned an unexpected status', {
            connectorId: id,
            raw: data,
          }),
        };
      }
      const nextAction: NextAction | undefined =
        status === 'pending' || status === 'requires_action'
          ? {
              type: 'customer_confirmation',
              channel: 'ussd',
              ...(nonEmpty(details.message) ? { message: details.message as string } : {}),
            }
          : undefined;
      return {
        ...base,
        status,
        ...(nextAction ? { nextAction } : {}),
        ...(error ? { error } : {}),
      };
    },

    async payout(request, context): Promise<ProviderResult> {
      const { recipient, amount } = request;
      const country = recipient.country;
      const paymentMethod = payoutMethods[country]?.[recipient.network];
      if (options.credentials[country] === undefined || paymentMethod === undefined) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `CinetPay payout method not configured for ${recipient.network} / ${country}`,
          { connectorId: id },
        );
      }
      if (amount.value < MIN_PAYOUT_AMOUNT || amount.value > MAX_PAYOUT_AMOUNT) {
        throw new PayenvError(
          'ROUTE_UNSUPPORTED',
          `CinetPay transfers amounts from ${MIN_PAYOUT_AMOUNT} to ${MAX_PAYOUT_AMOUNT}, got ${amount.value}`,
          { connectorId: id },
        );
      }

      const merchantReference = merchantTransactionId(context.reference);
      const body: Json = {
        currency: amount.currency,
        merchant_transaction_id: merchantReference,
        phone_number: recipient.phone,
        amount: amount.value,
        payment_method: paymentMethod,
        reason: request.description ?? `Payout ${request.idempotencyKey}`,
        notify_url: notifyUrlFor(request.idempotencyKey),
      };
      attemptCountries.set(context.reference, country);

      // A single call: money may leave the merchant's balance from here on. Without
      // CinetPay's transaction id, an uncertain transfer is looked up by its reference.
      let response: { httpStatus: number; data: Json };
      try {
        response = await call(country, 'POST', '/v1/transfer', context.signal, body);
      } catch (thrown) {
        throw toError('transfer', true, thrown);
      }
      const { httpStatus, data } = response;
      // A transfer status (even with an HTTP error, e.g. INSUFFICIENT_BALANCE) is final or
      // pending; anything else is an API error.
      if (httpStatus >= 500 || !isTransferStatus(apiStatus(data))) {
        throw toError('transfer', true, new CinetPayApiError('transfer', httpStatus, data));
      }
      return { ...transferResult(data, id), merchantReference };
    },

    async getStatus(query, context): Promise<StatusResult> {
      const identifier = query.providerRef ?? merchantTransactionId(query.reference);
      // The country is remembered by the instance that started the attempt. Otherwise
      // (e.g. after a restart) every configured country is asked.
      const known = attemptCountries.get(query.reference);
      const order = known ? [known, ...countries.filter((c) => c !== known)] : countries;
      for (const country of order) {
        const data = await lookup(query.operation, country, identifier, context.signal);
        if (data === undefined) continue;
        attemptCountries.set(query.reference, country);
        return query.operation === 'payout'
          ? { found: true, ...transferResult(data, id) }
          : toStatusResult(data, id);
      }
      // Every country account authoritatively answered "not found".
      return { found: false };
    },
  };
}

/**
 * The CinetPay `merchant_transaction_id` of an attempt: at most 30 letters and digits
 * (CinetPay's limit), derived from the attempt reference so it can be recomputed.
 * Payenv references (`att_<uuid>`) keep 120 random bits.
 */
export function merchantTransactionId(reference: string): string {
  return reference.replace(/[^A-Za-z0-9]/g, '').slice(-30);
}

/** Maps a CinetPay payment status response to a Payenv status result. */
export function toStatusResult(data: Json, connectorId: string): StatusResult {
  const { status, error } = transactionStatus(data, connectorId);
  const providerRef = nonEmpty(data.transaction_id);
  const merchantReference = nonEmpty(data.merchant_transaction_id);
  return {
    found: true,
    status,
    ...(providerRef ? { providerRef } : {}),
    ...(merchantReference ? { merchantReference } : {}),
    ...(error ? { error } : {}),
    raw: data,
  };
}

/** Maps a CinetPay transfer (creation answer or status lookup) to a Payenv result. */
function transferResult(data: Json, connectorId: string): ProviderResult {
  const { status, error } = transferStatus(data, connectorId);
  const providerRef = nonEmpty(data.transaction_id);
  const merchantReference = nonEmpty(data.merchant_transaction_id);
  return {
    status,
    ...(providerRef ? { providerRef } : {}),
    ...(merchantReference ? { merchantReference } : {}),
    ...(error ? { error } : {}),
    raw: data,
  };
}

/** CinetPay statuses that end a transfer, with the Payenv reason. */
const TRANSFER_FAILURES: Readonly<
  Record<string, { code: PayenvErrorCode; message: string; retryClass?: RetryClass }>
> = {
  // CinetPay gives no reason: never a reason to try another provider automatically.
  FAILED: { code: 'UNKNOWN_ERROR', message: 'failed', retryClass: 'do_not_retry' },
  // The merchant's CinetPay balance, not the recipient's: CinetPay sent nothing, and
  // another provider's balance may suffice.
  INSUFFICIENT_BALANCE: {
    code: 'INSUFFICIENT_BALANCE',
    message: 'refused: insufficient balance on the CinetPay account',
  },
  USER_NOT_FOUND: {
    code: 'INVALID_PHONE',
    message: 'failed: no mobile money account for this number',
  },
  USER_IS_BLOCKED: { code: 'INVALID_PHONE', message: "failed: the recipient's account is blocked" },
};

/**
 * Maps a CinetPay transfer status (`status` / `code`) to Payenv. Callers only pass
 * answers accepted by {@link isTransferStatus}.
 */
function transferStatus(
  data: Json,
  connectorId: string,
): { status: PaymentStatus; error?: PayenvError } {
  const status = apiStatus(data);
  switch (status) {
    case 'SUCCESS':
      return { status: 'succeeded' };
    // The recipient has nothing to do: the transfer is being processed.
    case 'INITIATED':
    case 'PENDING':
      return { status: 'pending' };
  }
  const failure = status ? TRANSFER_FAILURES[status] : undefined;
  if (!failure || !status) return { status: 'unknown' };
  const description = providerMessage(data);
  return {
    status: 'failed',
    error: new PayenvError(
      failure.code,
      `CinetPay transfer ${failure.message}${description ? ` — ${description}` : ''} (${status})`,
      {
        connectorId,
        providerCode: status,
        raw: data,
        ...(failure.retryClass ? { retryClass: failure.retryClass } : {}),
      },
    ),
  };
}

/** Whether an answer describes an existing transfer (not an API error). */
function isTransferStatus(status: string | undefined): boolean {
  return (
    status === 'SUCCESS' ||
    status === 'INITIATED' ||
    status === 'PENDING' ||
    (status !== undefined && status in TRANSFER_FAILURES)
  );
}

/** CinetPay statuses that end a payment, with the Payenv reason. */
const FAILURES: Readonly<
  Record<string, { status: PaymentStatus; code: PayenvErrorCode; message: string }>
> = {
  FAILED: { status: 'failed', code: 'CUSTOMER_DECLINED', message: 'failed' },
  EXPIRED: { status: 'expired', code: 'CUSTOMER_TIMEOUT', message: 'expired' },
  INSUFFICIENT_BALANCE: {
    status: 'failed',
    code: 'INSUFFICIENT_FUNDS',
    message: 'failed: insufficient balance',
  },
  USER_NOT_FOUND: {
    status: 'failed',
    code: 'INVALID_PHONE',
    message: 'failed: no mobile money account for this number',
  },
  USER_IS_BLOCKED: {
    status: 'failed',
    code: 'CUSTOMER_DECLINED',
    message: 'failed: the account is blocked',
  },
};

/** Maps a CinetPay status (`status` / `code`, status response or `details`) to Payenv. */
function transactionStatus(
  data: Json,
  connectorId: string,
): { status: PaymentStatus; error?: PayenvError } {
  const status = apiStatus(data);
  switch (status) {
    case 'SUCCESS':
      return { status: 'succeeded' };
    // Waiting for the customer (to confirm the push, or to pay on CinetPay's page).
    case 'INITIATED':
      return { status: 'requires_action' };
    // The customer has started paying.
    case 'PENDING':
      return { status: 'pending' };
  }
  const failure = status ? FAILURES[status] : undefined;
  if (!failure || !status) return { status: 'unknown' };
  const description = providerMessage(data);
  return {
    status: failure.status,
    error: new PayenvError(
      failure.code,
      `CinetPay payment ${failure.message}${description ? ` — ${description}` : ''} (${status})`,
      // Reported after the fact: never a reason to try another provider automatically.
      { connectorId, retryClass: 'do_not_retry', providerCode: status, raw: data },
    ),
  };
}

/** CinetPay error codes, by textual status. */
const API_ERRORS: Readonly<Record<string, PayenvErrorCode>> = {
  INVALID_CREDENTIALS: 'AUTHENTICATION_FAILED',
  INVALID_TOKEN: 'AUTHENTICATION_FAILED',
  EXPIRED_TOKEN: 'AUTHENTICATION_FAILED',
  // The server's IP is not on the account's whitelist: another provider may serve it.
  NOT_ALLOWED: 'ROUTE_UNSUPPORTED',
  INVALID_PARAMS: 'INVALID_REQUEST',
  OTP_ERROR: 'CUSTOMER_DECLINED',
  OTP_EXPIRED: 'CUSTOMER_TIMEOUT',
  FAILED: 'CUSTOMER_DECLINED',
  EXPIRED: 'CUSTOMER_TIMEOUT',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_FUNDS',
  USER_NOT_FOUND: 'INVALID_PHONE',
  USER_IS_BLOCKED: 'CUSTOMER_DECLINED',
};

function apiErrorCode(
  error: CinetPayApiError,
  moneyMayMove: boolean,
): { code: PayenvErrorCode; retryClass?: RetryClass } {
  const status = apiStatus(error.body);
  // A transaction with this attempt's reference already exists: only its status tells
  // whether money moved.
  if (status === 'TRANSACTION_EXIST') return { code: 'UNKNOWN_ERROR', retryClass: 'ambiguous' };
  // A transfer status sent with a server error: only a lookup tells whether money moved.
  // (Payment statuses such as INSUFFICIENT_BALANCE mean something else for transfers.)
  if (error.step === 'transfer' && isTransferStatus(status)) return { code: 'UNKNOWN_ERROR' };
  const mapped = status ? API_ERRORS[status] : undefined;
  if (mapped) return { code: mapped };
  if (error.httpStatus === 401 || error.httpStatus === 403) {
    return { code: 'AUTHENTICATION_FAILED' };
  }
  if (error.httpStatus === 429) return { code: 'RATE_LIMITED' };
  if (error.httpStatus >= 500 || status === 'OPERATION_ERROR' || error.httpStatus < 400) {
    // A server error, or an answer we cannot read.
    return moneyMayMove ? { code: 'UNKNOWN_ERROR' } : { code: 'PROVIDER_UNAVAILABLE' };
  }
  // Another 4xx: the request was rejected, nothing was processed.
  return { code: 'INVALID_REQUEST' };
}

/** Whether a status lookup describes an existing payment (not an API error). */
function isTransactionStatus(status: string | undefined): boolean {
  return (
    status === 'SUCCESS' ||
    status === 'INITIATED' ||
    status === 'PENDING' ||
    (status !== undefined && status in FAILURES)
  );
}

/** CinetPay's textual status, from `status` or the numeric `code`. */
function apiStatus(data: Json): string | undefined {
  if (typeof data.status === 'string' && data.status !== '') return data.status.toUpperCase();
  if (typeof data.code === 'number') return API_CODES[data.code];
  return undefined;
}

const API_CODES: Readonly<Record<number, string>> = {
  [-1]: 'OPERATION_ERROR',
  100: 'SUCCESS',
  200: 'OK',
  404: 'NOT_FOUND',
  1002: 'INVALID_TOKEN',
  1003: 'EXPIRED_TOKEN',
  1004: 'INVALID_PARAMS',
  1005: 'INVALID_CREDENTIALS',
  1200: 'TRANSACTION_EXIST',
  2001: 'INITIATED',
  2002: 'PENDING',
  2003: 'EXPIRED',
  2004: 'OTP_ERROR',
  2005: 'INSUFFICIENT_BALANCE',
  2006: 'USER_NOT_FOUND',
  2007: 'USER_IS_BLOCKED',
  2008: 'OTP_EXPIRED',
  2010: 'FAILED',
  2011: 'NOT_ALLOWED',
};

function providerMessage(data: Json): string | undefined {
  return nonEmpty(data.description) ?? nonEmpty(data.message);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isJson(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response): Promise<Json> {
  const text = await response.text();
  try {
    const data: unknown = text ? JSON.parse(text) : {};
    return isJson(data) ? data : { value: data };
  } catch {
    return { raw: text };
  }
}
