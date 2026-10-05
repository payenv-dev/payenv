import type { CollectRequest, Connector, Operation } from './connector.js';
import { methodCountry, methodNetwork } from './method.js';

/** Orders the connectors that support a request. The first one is tried first. */
export type RoutingStrategy = (
  candidates: readonly Connector[],
  request: CollectRequest,
) => readonly Connector[] | Promise<readonly Connector[]>;

/** Whether the connector declares a capability matching the request. */
export function supports(
  connector: Connector,
  operation: Operation,
  request: CollectRequest,
): boolean {
  const { method, amount } = request;
  const country = methodCountry(method);
  const network = methodNetwork(method);

  return connector
    .capabilities()
    .some(
      (capability) =>
        capability.operation === operation &&
        capability.method === method.type &&
        capability.currencies.includes(amount.currency) &&
        (capability.countries === undefined ||
          (country !== undefined && capability.countries.includes(country))) &&
        (capability.networks === undefined ||
          (network !== undefined && capability.networks.includes(network))) &&
        (capability.widget === undefined ||
          (request.supportedWidgets?.includes(capability.widget) ?? false)),
    );
}

/**
 * Tries connectors in a fixed order. Connectors not listed keep their registration
 * order, after the listed ones. Without an order, registration order is used.
 */
export function priority(order: readonly string[] = []): RoutingStrategy {
  const rank = (connector: Connector) => {
    const index = order.indexOf(connector.id);
    return index === -1 ? order.length : index;
  };
  // Array.prototype.sort is stable, so ties keep registration order.
  return (candidates) => [...candidates].sort((a, b) => rank(a) - rank(b));
}
