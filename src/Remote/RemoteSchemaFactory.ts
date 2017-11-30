// Code from https://github.com/apollographql/graphql-tools

// The MIT License (MIT)

// Copyright (c) 2015 - 2017 Meteor Development Group, Inc.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

import { printSchema, Kind, ValueNode } from 'graphql'
import { linkToFetcher, linkToObserver } from './linkToFetcher'
import { PubSub } from 'graphql-subscriptions'
import { ApolloLink, FetchResult } from 'apollo-link'

import {
  GraphQLObjectType,
  GraphQLFieldResolver,
  GraphQLSchema,
  GraphQLInterfaceType,
  GraphQLUnionType,
  GraphQLID,
  GraphQLString,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLInt,
  GraphQLScalarType,
  ExecutionResult,
  print,
} from 'graphql'
import defaultMergedResolver from './defaultMergedResolver'
import { checkResultAndHandleErrors } from './errors'
import { IResolverObject, IResolvers } from '../types'
import { makeExecutableSchema } from 'graphql-tools'
import { isEmptyObject, resolveFromParentTypename } from './utils'
import { Observable } from 'subscriptions-transport-ws'
import * as scuid from 'scuid'

export type Fetcher = (operation: FetcherOperation) => Promise<ExecutionResult>
export type Observer = (
  fetcherOperation: FetcherOperation,
) => Observable<ExecutionResult>

export type FetcherOperation = {
  query: string
  operationName?: string
  variables?: { [key: string]: any }
  context?: { [key: string]: any }
}

export class RemoteSchemaFactory {
  link: ApolloLink
  fetcher: Fetcher
  observer: Observer
  schema: GraphQLSchema
  remoteSchema: GraphQLSchema
  constructor(
    schema: GraphQLSchema,
    link: ApolloLink,
  ) {

    this.schema = schema
    this.link = link
    this.fetcher = linkToFetcher(link)
    this.observer = linkToObserver(link)
    this.init()
  }

  getSchema() {
    return this.remoteSchema
  }

  setLink(link: ApolloLink) {
    this.link = link
    this.fetcher = linkToFetcher(link)
    this.observer = linkToObserver(link)
  }

  private init() {
    const pubsub = new PubSub()

    const queryType = this.schema.getQueryType()
    const queries = queryType.getFields()
    const queryResolvers: IResolverObject = {}
    Object.keys(queries).forEach(key => {
      queryResolvers[key] = this.createResolver(this.fetcher)
    })
    let mutationResolvers: IResolverObject = {}
    const mutationType = this.schema.getMutationType()
    if (mutationType) {
      const mutations = mutationType.getFields()
      Object.keys(mutations).forEach(key => {
        mutationResolvers[key] = this.createResolver(this.fetcher)
      })
    }

    const subscriptionType = this.schema.getSubscriptionType()
    let subscriptionResolvers: IResolverObject = {}
    if (subscriptionType) {
      const subscriptions = subscriptionType.getFields()
      Object.keys(subscriptions).forEach(key => {
        subscriptionResolvers[key] = {
          subscribe: this.createSubscriptionResolver(this.observer, pubsub),
        }
      })
    }

    const resolvers: IResolvers = { [queryType.name]: queryResolvers }

    if (!isEmptyObject(mutationResolvers)) {
      resolvers[mutationType.name] = mutationResolvers
    }

    if (!isEmptyObject(subscriptionResolvers)) {
      resolvers[subscriptionType.name] = subscriptionResolvers
    }

    const typeMap = this.schema.getTypeMap()
    const types = Object.keys(typeMap).map(name => typeMap[name])
    for (const type of types) {
      if (
        type instanceof GraphQLInterfaceType ||
        type instanceof GraphQLUnionType
      ) {
        resolvers[type.name] = {
          __resolveType(parent, context, info) {
            return resolveFromParentTypename(parent, info.schema)
          },
        }
      } else if (type instanceof GraphQLScalarType) {
        if (
          !(
            type === GraphQLID ||
            type === GraphQLString ||
            type === GraphQLFloat ||
            type === GraphQLBoolean ||
            type === GraphQLInt
          )
        ) {
          resolvers[type.name] = this.createPassThroughScalar(type)
        }
      } else if (
        type instanceof GraphQLObjectType &&
        type.name.slice(0, 2) !== '__' &&
        type !== queryType &&
        type !== mutationType &&
        type !== subscriptionType
      ) {
        const resolver = {}
        Object.keys(type.getFields()).forEach(field => {
          resolver[field] = defaultMergedResolver
        })
        resolvers[type.name] = resolver
      }
    }

    const typeDefs = printSchema(this.schema)

    this.remoteSchema = makeExecutableSchema({
      typeDefs,
      resolvers,
    })
  }

  private createResolver(fetcher: Fetcher): GraphQLFieldResolver<any, any> {
    return async (root, args, context, info) => {
      const fragments = Object.keys(info.fragments).map(
        fragment => info.fragments[fragment],
      )
      const document = {
        kind: Kind.DOCUMENT,
        definitions: [info.operation, ...fragments],
      }
      const result = await fetcher({
        query: print(document),
        variables: info.variableValues,
        context: { graphqlContext: context },
      })
      return checkResultAndHandleErrors(result, info)
    }
  }

  private createSubscriptionResolver(
    observer: Observer,
    pubsub: PubSub,
  ): GraphQLFieldResolver<any, any> {
    return async (root, args, context, info) => {
      const fragments = Object.keys(info.fragments).map(
        fragment => info.fragments[fragment],
      )
      const document = {
        kind: Kind.DOCUMENT,
        definitions: [info.operation, ...fragments],
      }
      const query = print(document)
      const id = scuid()
      observer({
        query,
        variables: info.variableValues,
        context: { graphqlContext: context },
      }).subscribe({
        next: data => {
          pubsub.publish(id, data.data)
        },
      })

      return pubsub.asyncIterator(id)
    }
  }

  private createPassThroughScalar({
    name,
    description,
  }: {
    name: string
    description: string
  }): GraphQLScalarType {
    return new GraphQLScalarType({
      name: name,
      description: description,
      serialize(value) {
        return value
      },
      parseValue(value) {
        return value
      },
      parseLiteral(ast) {
        return this.parseLiteral(ast)
      },
    })
  }

  private parseLiteral = (ast: ValueNode): any => {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN: {
        return ast.value
      }
      case Kind.INT:
      case Kind.FLOAT: {
        return parseFloat(ast.value)
      }
      case Kind.OBJECT: {
        const value = Object.create(null)
        ast.fields.forEach(field => {
          value[field.name.value] = this.parseLiteral(field.value)
        })

        return value
      }
      case Kind.LIST: {
        return ast.values.map(this.parseLiteral)
      }
      default:
        return null
    }
  }
}
