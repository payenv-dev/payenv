/**
 * Unified payment status.
 *
 * `unknown` means Payenv could not determine whether money moved. It is never
 * guessed: the application must reconcile it later (see `Payenv.refresh`).
 */
export type PaymentStatus =
  | 'created'
  | 'pending'
  | 'requires_action'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown';

export type TerminalStatus = Extract<
  PaymentStatus,
  'succeeded' | 'failed' | 'canceled' | 'expired'
>;

const TERMINAL: ReadonlySet<PaymentStatus> = new Set([
  'succeeded',
  'failed',
  'canceled',
  'expired',
]);

export function isTerminal(status: PaymentStatus): status is TerminalStatus {
  return TERMINAL.has(status);
}

const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  created: ['pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'expired', 'unknown'],
  pending: ['requires_action', 'succeeded', 'failed', 'canceled', 'expired', 'unknown'],
  requires_action: ['pending', 'succeeded', 'failed', 'canceled', 'expired', 'unknown'],
  unknown: ['pending', 'requires_action', 'succeeded', 'failed', 'canceled', 'expired'],
  succeeded: [],
  failed: [],
  canceled: [],
  expired: [],
};

/** Whether a payment may move from `from` to `to`. Terminal statuses never change. */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
