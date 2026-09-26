import type {
  AttemptContext,
  Capability,
  CollectRequest,
  Connector,
  ProviderResult,
  StatusQuery,
  StatusResult,
} from '../src/index.js';

type CollectBehavior = (
  request: CollectRequest,
  context: AttemptContext,
) => Promise<ProviderResult>;
type StatusBehavior = (query: StatusQuery) => Promise<StatusResult>;

export interface FakeConnector extends Connector {
  collectCalls: AttemptContext[];
  statusCalls: StatusQuery[];
}

export const MTN_BJ_XOF: Capability = {
  operation: 'collect',
  method: 'mobile_money',
  currencies: ['XOF'],
  countries: ['BJ'],
  networks: ['mtn', 'moov'],
};

export function fakeConnector(
  id: string,
  collect: CollectBehavior,
  getStatus: StatusBehavior = async () => ({ found: false }),
  capabilities: readonly Capability[] = [MTN_BJ_XOF],
): FakeConnector {
  const connector: FakeConnector = {
    id,
    collectCalls: [],
    statusCalls: [],
    capabilities: () => capabilities,
    async collect(request, context) {
      connector.collectCalls.push(context);
      return collect(request, context);
    },
    async getStatus(query) {
      connector.statusCalls.push(query);
      return getStatus(query);
    },
  };
  return connector;
}

let counter = 0;

export function mtnRequest(overrides: Partial<CollectRequest> = {}): CollectRequest {
  counter += 1;
  return {
    amount: { value: 5000, currency: 'XOF' },
    method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
    customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    idempotencyKey: `order_${counter}`,
    ...overrides,
  };
}

export const pending = async (): Promise<ProviderResult> => ({
  status: 'pending',
  providerRef: 'prov_1',
  nextAction: { type: 'customer_confirmation', channel: 'ussd' },
});
