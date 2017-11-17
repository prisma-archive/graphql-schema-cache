import { DefinitionNode, GraphQLFieldResolver, GraphQLScalarType } from 'graphql'
import { Options } from 'graphql-request/dist/src/types'
import { IResolverOptions } from 'graphql-tools/dist/Interfaces'

export interface Args {
  [key: string]: any
}

export interface Context {
  [key: string]: any
}

export interface DefinitionMap {
  [key: string]: DefinitionNode
}

export const builtinTypes = ['String', 'Float', 'Int', 'Boolean', 'ID']


export interface HybridLinkOptions {
  http: HttpOptions
  ws?: WsOptions
}

export interface HttpOptions {
  uri: string,
  options?: Options
}

export interface WsOptions {
  uri: string
  options?: {
    reconnect?: boolean
    params?: any
  }
}

export type IResolverObject = {
  [key: string]: GraphQLFieldResolver<any, any> | IResolverOptions;
};
export interface IResolvers {
  [key: string]: (() => any) | IResolverObject | GraphQLScalarType;
}
