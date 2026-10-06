import type {
  CollectRequest,
  Connector,
  Operation,
  PayoutRequest,
  ProviderResult,
  StatusQuery,
  StatusResult,
} from './connector.js';
import { isPayenvError, PayenvError, type SerializedError } from './errors.js';
import { assertValidMoney } from './money.js';
import type { Attempt, Payment } from './payment.js';
import { priority, type RoutingStrategy, supports } from './router.js';
import { canTransition, isTerminal, type PaymentStatus } from './status.js';
import { createMemoryStore, type Store } from './store.js';

export type PayenvEvent =
  | { type: 'attempt.started'; payment: Payment; attempt: Attempt }
  | { type: 'attempt.finished'; payment: Payment; attempt: Attempt }
  | { type: 'fallback'; payment: Payment; from: string; to: string; reason: SerializedError }
  | { type: 'payment.updated'; payment: Payment };

export interface PayenvOptions {
  connectors: readonly Connector[];
  /** Defaults to {@link priority} with registration order. */
  routing?: RoutingStrategy;
  /**
   * Defaults to an in-memory store, which is only suitable for development:
   * idempotency is lost on restart and not shared between instances.
   */
  store?: Store;
  /** Maximum duration of a single provider call. Defaults to 30 seconds. */
  attemptTimeoutMs?: number;
  /**
   * Delays before each status check when an attempt is ambiguous.
   * Defaults to `[1000, 3000, 5000]` (three checks).
   */
  statusCheckDelaysMs?: readonly number[];
  /** Called for every lifecycle event. Errors thrown by the handler are ignored. */
  onEvent?: (event: PayenvEvent) => void;
}

export interface Payenv {
  /** Collects a payment, falling back between connectors only when it is proven safe. */
  collect(request: CollectRequest): Promise<Payment>;
  /**
   * Sends money to a recipient, with the same guarantees as `collect`: idempotency, and
   * fallback to another connector only when it is proven that no money was sent.
   */
  payout(request: PayoutRequest): Promise<Payment>;
  getPayment(idempotencyKey: string): Promise<Payment | undefined>;
  /** Asks the provider for the latest status of a non-terminal payment. */
  refresh(idempotencyKey: string): Promise<Payment>;
  /**
   * Links a provider transaction to a payment started in a widget (`nextAction.type ===
   * 'widget'`), then updates its status. The transaction is first checked with the
   * provider: it must carry this payment's merchant reference and amount, so a customer
   * cannot confirm an order with another transaction.
   */
  confirm(idempotencyKey: string, providerRef: string): Promise<Payment>;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 30_000;
const DEFAULT_STATUS_CHECK_DELAYS_MS = [1_000, 3_000, 5_000];
const E164 = /^\+[1-9]\d{6,14}$/;

/** How the engine concludes an attempt. Only `fallback` lets the next connector run. */
type Decision =
  | { kind: 'accept'; result: ProviderResult }
  | { kind: 'fallback'; error: PayenvError }
  | { kind: 'fail'; status: PaymentStatus; error: PayenvError }
  | { kind: 'unresolved'; error: PayenvError };

type Classification = Decision | { kind: 'ambiguous'; error: PayenvError };

export function createPayenv(options: PayenvOptions): Payenv {
  const connectors = [...options.connectors];
  if (connectors.length === 0) {
    throw new PayenvError('INVALID_REQUEST', 'At least one connector is required');
  }
  const ids = new Set<string>();
  for (const connector of connectors) {
    if (ids.has(connector.id)) {
      throw new PayenvError('INVALID_REQUEST', `Duplicate connector id "${connector.id}"`);
    }
    ids.add(connector.id);
  }

  const routing = options.routing ?? priority();
  const store = options.store ?? createMemoryStore();
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const statusCheckDelaysMs = options.statusCheckDelaysMs ?? DEFAULT_STATUS_CHECK_DELAYS_MS;

  function emit(event: PayenvEvent): void {
    if (!options.onEvent) return;
    try {
      options.onEvent(structuredClone(event));
    } catch {
      // A faulty event handler must never break a payment.
    }
  }

  async function save(payment: Payment): Promise<void> {
    payment.updatedAt = now();
    await store.update(payment);
    emit({ type: 'payment.updated', payment });
  }

  async function checkStatus(connector: Connector, query: StatusQuery): Promise<StatusResult> {
    const controller = new AbortController();
    return withTimeout(
      connector.getStatus(query, { signal: controller.signal }),
      attemptTimeoutMs,
      controller,
    );
  }

  /**
   * Called when we don't know whether the provider processed the attempt.
   * Only the same provider can tell us; we never move on while it could still succeed.
   */
  async function resolveAmbiguous(
    connector: Connector,
    query: StatusQuery,
    cause: PayenvError,
  ): Promise<Decision> {
    for (const delay of statusCheckDelaysMs) {
      await sleep(delay);
      let status: StatusResult;
      try {
        status = await checkStatus(connector, query);
      } catch {
        continue;
      }
      if (!status.found) return { kind: 'fallback', error: cause };
      const classification = classify(status, connector);
      if (classification.kind !== 'ambiguous') return classification;
    }
    return { kind: 'unresolved', error: cause };
  }

  async function runAttempt(
    connector: Connector,
    request: CollectRequest | PayoutRequest,
    payment: Payment,
    attempt: Attempt,
  ): Promise<Decision> {
    const controller = new AbortController();
    const query: StatusQuery = { operation: payment.operation, reference: attempt.reference };
    const recordProviderRef = (providerRef: string) => {
      attempt.providerRef = providerRef;
      query.providerRef = providerRef;
    };
    let classification: Classification;
    try {
      const context = {
        paymentId: payment.id,
        attemptId: attempt.id,
        reference: attempt.reference,
        idempotencyKey: attempt.id,
        signal: controller.signal,
        reportProviderRef: recordProviderRef,
      };
      const call =
        payment.operation === 'payout'
          ? callPayout(connector, request as PayoutRequest, context)
          : connector.collect(request as CollectRequest, context);
      const result = await withTimeout(call, attemptTimeoutMs, controller);
      if (result.providerRef !== undefined) recordProviderRef(result.providerRef);
      classification = classify(result, connector);
    } catch (thrown) {
      const error = toPayenvError(connector, thrown);
      classification =
        error.retryClass === 'safe_to_fallback'
          ? { kind: 'fallback', error }
          : error.retryClass === 'do_not_retry'
            ? { kind: 'fail', status: 'failed', error }
            : { kind: 'ambiguous', error };
    }
    if (classification.kind !== 'ambiguous') return classification;
    return resolveAmbiguous(connector, query, classification.error);
  }

  function apply(payment: Payment, attempt: Attempt, decision: Decision): void {
    attempt.endedAt = now();
    switch (decision.kind) {
      case 'accept': {
        const { result } = decision;
        const status = result.status === 'created' ? 'pending' : result.status;
        attempt.status = status;
        attempt.outcome = 'accepted';
        if (result.providerRef !== undefined) attempt.providerRef = result.providerRef;
        if (result.merchantReference !== undefined) {
          attempt.merchantReference = result.merchantReference;
        }
        payment.status = status;
        setOptional(payment, 'providerRef', attempt.providerRef);
        setOptional(payment, 'nextAction', result.nextAction);
        delete payment.error;
        return;
      }
      case 'fallback':
        attempt.status = 'failed';
        attempt.outcome = 'fell_back';
        attempt.error = decision.error.toJSON();
        return;
      case 'fail':
        attempt.status = decision.status;
        attempt.outcome = 'failed';
        attempt.error = decision.error.toJSON();
        payment.status = decision.status;
        payment.error = attempt.error;
        setOptional(payment, 'providerRef', attempt.providerRef);
        return;
      case 'unresolved':
        attempt.status = 'unknown';
        attempt.outcome = 'unresolved';
        attempt.error = decision.error.toJSON();
        payment.status = 'unknown';
        payment.error = attempt.error;
        setOptional(payment, 'providerRef', attempt.providerRef);
        return;
    }
  }

  /**
   * Runs a collection or a payout. `route` is the request as the router sees it (for
   * payouts, `method` is the recipient); `original` is what the connector receives.
   */
  async function start(
    operation: Operation,
    route: CollectRequest,
    original: CollectRequest | PayoutRequest,
  ): Promise<Payment> {
    const request = route;
    validate(request);
    const fingerprint = fingerprintOf(operation, request);

    const existing = await store.get(request.idempotencyKey);
    if (existing) return assertSameRequest(existing, fingerprint);

    const eligible = connectors.filter(
      (connector) =>
        supports(connector, operation, request) &&
        (operation === 'collect' || typeof connector.payout === 'function'),
    );
    const candidates = eligible.length === 0 ? [] : await routing(eligible, request);
    if (candidates.length === 0) {
      throw new PayenvError(
        'NO_ROUTE',
        `No connector supports ${operation} ${describeRoute(request)}. Check the connectors' capabilities.`,
      );
    }

    const createdAt = now();
    const payment: Payment = {
      id: `pay_${crypto.randomUUID()}`,
      idempotencyKey: request.idempotencyKey,
      operation,
      status: 'created',
      amount: request.amount,
      method: request.method,
      attempts: [],
      fingerprint,
      createdAt,
      updatedAt: createdAt,
    };
    setOptional(payment, 'customer', request.customer);
    setOptional(payment, 'description', request.description);
    setOptional(payment, 'metadata', request.metadata);

    if (!(await store.create(payment))) {
      // Another call with the same key won the race: it owns the payment.
      const winner = await store.get(request.idempotencyKey);
      if (!winner) throw new PayenvError('UNKNOWN_ERROR', 'Store lost a payment it just refused');
      return assertSameRequest(winner, fingerprint);
    }

    let lastError: PayenvError | undefined;
    for (const [index, connector] of candidates.entries()) {
      const attemptId = `att_${crypto.randomUUID()}`;
      const attempt: Attempt = {
        id: attemptId,
        connectorId: connector.id,
        reference: attemptId,
        status: 'created',
        startedAt: now(),
      };
      payment.attempts.push(attempt);
      payment.connectorId = connector.id;
      await save(payment);
      emit({ type: 'attempt.started', payment, attempt });

      const decision = await runAttempt(connector, original, payment, attempt);
      apply(payment, attempt, decision);
      await save(payment);
      emit({ type: 'attempt.finished', payment, attempt });

      // The safe-fallback invariant: only a proven "no money moved" lets us continue.
      if (decision.kind !== 'fallback') return payment;

      lastError = decision.error;
      const next = candidates[index + 1];
      if (next) {
        emit({
          type: 'fallback',
          payment,
          from: connector.id,
          to: next.id,
          reason: decision.error.toJSON(),
        });
      }
    }

    payment.status = 'failed';
    if (lastError) payment.error = lastError.toJSON();
    await save(payment);
    return payment;
  }

  async function load(idempotencyKey: string) {
    const payment = await store.get(idempotencyKey);
    if (!payment) {
      throw new PayenvError('PAYMENT_NOT_FOUND', `No payment with key "${idempotencyKey}"`);
    }
    const attempt = payment.attempts.at(-1);
    const connector =
      attempt && connectors.find((candidate) => candidate.id === attempt.connectorId);
    if (attempt && !connector) {
      throw new PayenvError(
        'INVALID_REQUEST',
        `Connector "${attempt.connectorId}" is not configured; cannot update this payment`,
      );
    }
    return { payment, attempt, connector };
  }

  async function lookup(
    connector: Connector,
    payment: Payment,
    attempt: Attempt,
    providerRef?: string,
  ) {
    const query: StatusQuery = { operation: payment.operation, reference: attempt.reference };
    const ref = providerRef ?? attempt.providerRef;
    if (ref !== undefined) query.providerRef = ref;
    try {
      return await checkStatus(connector, query);
    } catch (thrown) {
      throw toPayenvError(connector, thrown);
    }
  }

  /** Applies a provider status to a payment. Returns false if the transition is not allowed. */
  function applyStatus(
    payment: Payment,
    attempt: Attempt,
    status: Extract<StatusResult, { found: true }>,
  ): boolean {
    const next = status.status === 'created' ? 'pending' : status.status;
    if (!canTransition(payment.status, next)) return false;
    attempt.status = next;
    // Keep the attempt's conclusion consistent with what the provider now reports.
    if (next === 'failed' || next === 'canceled' || next === 'expired') {
      attempt.outcome = 'failed';
    } else if (next !== 'unknown') {
      attempt.outcome = 'accepted';
      // A timeout recorded while the outcome was unknown no longer describes the payment.
      delete payment.error;
    }
    payment.status = next;
    if (status.providerRef !== undefined) {
      attempt.providerRef = status.providerRef;
      payment.providerRef = status.providerRef;
    }
    setOptional(payment, 'nextAction', status.nextAction);
    if (status.error) {
      attempt.error = status.error.toJSON();
      payment.error = attempt.error;
    }
    return true;
  }

  async function refresh(idempotencyKey: string): Promise<Payment> {
    const { payment, attempt, connector } = await load(idempotencyKey);
    if (isTerminal(payment.status) || !attempt || !connector) return payment;
    // A widget payment has nothing to look up until the customer completes it (confirm).
    if (payment.status === 'requires_action' && attempt.providerRef === undefined) return payment;

    const status = await lookup(connector, payment, attempt);
    if (!status.found) {
      const error = new PayenvError(
        'PAYMENT_NOT_FOUND',
        'The provider has no record of this payment',
        { connectorId: connector.id },
      ).toJSON();
      attempt.status = 'failed';
      attempt.outcome = 'failed';
      attempt.error = error;
      payment.status = 'failed';
      payment.error = error;
    } else if (!applyStatus(payment, attempt, status)) {
      return payment;
    }
    await save(payment);
    return payment;
  }

  async function confirm(idempotencyKey: string, providerRef: string): Promise<Payment> {
    if (typeof providerRef !== 'string' || providerRef === '') {
      throw new PayenvError('INVALID_REQUEST', 'providerRef must be a non-empty string');
    }
    const { payment, attempt, connector } = await load(idempotencyKey);
    if (!attempt || !connector) {
      throw new PayenvError('INVALID_REQUEST', 'This payment has no attempt to confirm');
    }
    if (payment.operation !== 'collect') {
      throw new PayenvError(
        'INVALID_REQUEST',
        'Only collections started in a widget can be confirmed',
      );
    }
    if (attempt.providerRef !== undefined) {
      // Confirming twice with the same transaction is harmless; another one is not.
      if (attempt.providerRef === providerRef) return refresh(idempotencyKey);
      throw new PayenvError(
        'REFERENCE_MISMATCH',
        'This payment is already linked to another provider transaction',
        { connectorId: connector.id },
      );
    }
    if (attempt.merchantReference === undefined) {
      throw new PayenvError(
        'INVALID_REQUEST',
        `Connector "${connector.id}" did not attach a merchant reference; this payment cannot be confirmed`,
      );
    }

    const status = await lookup(connector, payment, attempt, providerRef);
    if (!status.found) {
      throw new PayenvError(
        'PAYMENT_NOT_FOUND',
        `The provider has no transaction "${providerRef}"`,
        {
          connectorId: connector.id,
        },
      );
    }
    // Anti-fraud: the provider transaction must be this payment's, for this amount.
    if (status.merchantReference !== attempt.merchantReference) {
      throw new PayenvError(
        'REFERENCE_MISMATCH',
        'The provider transaction does not belong to this payment',
        { connectorId: connector.id },
      );
    }
    if (
      status.amount === undefined ||
      status.amount.value !== payment.amount.value ||
      status.amount.currency !== payment.amount.currency
    ) {
      throw new PayenvError(
        'REFERENCE_MISMATCH',
        'The provider transaction amount does not match this payment',
        { connectorId: connector.id },
      );
    }

    attempt.providerRef = providerRef;
    payment.providerRef = providerRef;
    applyStatus(payment, attempt, { ...status, providerRef });
    await save(payment);
    return payment;
  }

  const collect = (request: CollectRequest) => start('collect', request, request);

  const payout = (request: PayoutRequest) =>
    start(
      'payout',
      {
        amount: request.amount,
        method: request.recipient,
        idempotencyKey: request.idempotencyKey,
        ...(request.customer ? { customer: request.customer } : {}),
        ...(request.description ? { description: request.description } : {}),
        ...(request.metadata ? { metadata: request.metadata } : {}),
      },
      request,
    );

  return {
    collect,
    payout,
    getPayment: (idempotencyKey) => store.get(idempotencyKey),
    refresh,
    confirm,
  };
}

function classify(result: ProviderResult, connector: Connector): Classification {
  switch (result.status) {
    case 'created':
    case 'pending':
    case 'requires_action':
    case 'succeeded':
      return { kind: 'accept', result };
    case 'unknown':
      return {
        kind: 'ambiguous',
        error:
          result.error ??
          new PayenvError('UNKNOWN_ERROR', 'Provider returned an unknown status', {
            connectorId: connector.id,
          }),
      };
    case 'failed':
    case 'canceled':
    case 'expired': {
      // A failure without a reason is not proof that another provider is safe to try.
      const error =
        result.error ??
        new PayenvError('UNKNOWN_ERROR', `Provider reported "${result.status}" without a reason`, {
          connectorId: connector.id,
          retryClass: 'do_not_retry',
        });
      if (error.retryClass === 'safe_to_fallback') return { kind: 'fallback', error };
      if (error.retryClass === 'ambiguous') return { kind: 'ambiguous', error };
      return { kind: 'fail', status: result.status, error };
    }
  }
}

function toPayenvError(connector: Connector, thrown: unknown): PayenvError {
  if (isPayenvError(thrown)) return thrown;
  if (connector.mapError) {
    try {
      const mapped = connector.mapError(thrown);
      if (isPayenvError(mapped)) return mapped;
    } catch {
      // Fall through: an unmappable error is treated as ambiguous.
    }
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  return new PayenvError('UNKNOWN_ERROR', message, { connectorId: connector.id, cause: thrown });
}

function withTimeout<T>(promise: Promise<T>, ms: number, controller: AbortController): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new PayenvError('TIMEOUT', `Provider call timed out after ${ms} ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function validate(request: CollectRequest): void {
  const key = request.idempotencyKey;
  if (typeof key !== 'string' || key.length === 0 || key.length > 255) {
    throw new PayenvError(
      'INVALID_REQUEST',
      'idempotencyKey must be a string of 1 to 255 characters',
    );
  }
  assertValidMoney(request.amount);
  const { method } = request;
  if (method.type === 'mobile_money' && !E164.test(method.phone)) {
    throw new PayenvError(
      'INVALID_PHONE',
      'Mobile money phone must be in E.164 format, e.g. "+22990000000"',
    );
  }
}

function callPayout(
  connector: Connector,
  request: PayoutRequest,
  context: Parameters<NonNullable<Connector['payout']>>[1],
): Promise<ProviderResult> {
  if (!connector.payout) {
    return Promise.reject(
      new PayenvError('ROUTE_UNSUPPORTED', `Connector "${connector.id}" does not support payouts`),
    );
  }
  return connector.payout(request, context);
}

function fingerprintOf(operation: Operation, request: CollectRequest): string {
  const { amount, method } = request;
  const target =
    method.type === 'mobile_money'
      ? [method.network, method.country, method.phone]
      : method.type === 'card'
        ? [method.token]
        : [method.returnUrl];
  return JSON.stringify([operation, amount.value, amount.currency, method.type, ...target]);
}

function assertSameRequest(payment: Payment, fingerprint: string): Payment {
  if (payment.fingerprint !== fingerprint) {
    throw new PayenvError(
      'IDEMPOTENCY_CONFLICT',
      `idempotencyKey "${payment.idempotencyKey}" was already used with a different request`,
    );
  }
  return payment;
}

function describeRoute(request: CollectRequest): string {
  const { method, amount } = request;
  const parts: string[] = [method.type];
  if (method.type === 'mobile_money') parts.push(method.network);
  if (method.country) parts.push(method.country);
  parts.push(amount.currency);
  return parts.join(' / ');
}

function setOptional<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
) {
  if (value === undefined) delete target[key];
  else target[key] = value;
}

function now(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
