import { HybridLink } from './HybridLink'

export class GraphcoolLink extends HybridLink {
  constructor(serviceId: string, token?: string) {
    const headers = token ? {
      Authorization: `Bearer ${token}`
    } : {}
    super({
      http: {
        uri: `https://api.graph.cool/simple/v1/${serviceId}`,
        options: {
          headers,
        }
      },
      ws: {
        uri: `wss://subscriptions.graph.cool/v1/${serviceId}`,
        options: {
          params: headers,
        }
      }
    })
  }
}