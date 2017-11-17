import { ApolloLink, FetchResult, Operation, split } from 'apollo-link'
import { HttpOptions, HybridLinkOptions, WsOptions } from './types'
import { FetchOptions, HttpLink } from 'apollo-link-http'
import { WebSocketLink } from 'apollo-link-ws'
import { SubscriptionClient } from 'subscriptions-transport-ws'
import { merge } from 'lodash'
import { OperationDefinitionNode } from 'graphql'
import * as ws from 'ws'
import * as fetch from 'cross-fetch'

export class HybridLink extends ApolloLink {
  uri: string
  wsUri?: string
  constructor(
    endpointOrOptions: string | HybridLinkOptions,
    subscriptionsEndpoint?: string,
  ) {
    super(HybridLink.getLink(endpointOrOptions, subscriptionsEndpoint).request)
    this.uri = typeof endpointOrOptions === 'string' ? endpointOrOptions : endpointOrOptions.http.uri
    this.wsUri = typeof endpointOrOptions === 'string' ? undefined : endpointOrOptions.ws.uri
  }

  private static getLink(
    endpointOrOptions: string | HybridLinkOptions,
    subscriptionsEndpoint?: string,
  ) {

    let options: HybridLinkOptions

    if (typeof endpointOrOptions === 'string') {
      options = {
        http: {
          uri: endpointOrOptions,
        },
      }

      if (subscriptionsEndpoint) {
        options.ws = {
          uri: subscriptionsEndpoint,
        }
      }
    } else {
      options = merge(
        {
          ws: {
            options: {
              reconnect: true,
            },
          },
        },
        endpointOrOptions,
      )
    }

    return split(
      op => HybridLink.isSubscription(op),
      HybridLink.getWebsocketLink(options.ws),
      HybridLink.getHttpLink(options.http),
    )
  }

  private static isSubscription = (operation: Operation): boolean => {
    const selectedOperation = HybridLink.getSelectedOperation(operation)
    if (selectedOperation) {
      return selectedOperation.operation === 'subscription'
    }
    return false
  }

  private static getSelectedOperation(
    operation: Operation,
  ): OperationDefinitionNode | null {
    if (operation.query.definitions.length === 1) {
      return operation.query.definitions[0] as OperationDefinitionNode
    }

    if (operation.query.definitions.length > 1) {
      return (
        (operation.query.definitions.find(d => {
          if (d.kind === 'OperationDefinition') {
            return d.name.value === operation.operationName
          }
        }) as OperationDefinitionNode) || null
      )
    }

    return null
  }

  private static getWebsocketLink(wsOptions: WsOptions): WebSocketLink {
    const subscriptionClient = new SubscriptionClient(wsOptions.uri, {
      reconnect: wsOptions.options.reconnect,
    }, ws)
    return new WebSocketLink(subscriptionClient)
  }

  private static getHttpLink(http: FetchOptions): HttpLink {
    return new HttpLink({...http, fetch})
  }
}
