// Contains copied code from https://github.com/apollographql/graphql-tools

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
  printSchema,
  Kind,
  ValueNode,
} from 'graphql'
import { ApolloLink } from 'apollo-link'
import { makeExecutableSchema } from 'graphql-tools'
import linkToFetcher from 'graphql-tools/dist/stitching/linkToFetcher'
import defaultMergedResolver from 'graphql-tools/dist/stitching/defaultMergedResolver'
import { checkResultAndHandleErrors } from 'graphql-tools/dist/stitching/errors'
import { IResolverObject, IResolvers } from 'graphql-tools/dist/Interfaces'
import resolveFromParentTypename from 'graphql-tools/dist/stitching/resolveFromParentTypename'
import isEmptyObject from 'graphql-tools/dist/isEmptyObject'

export type Fetcher = (operation: FetcherOperation) => Promise<ExecutionResult>

export type FetcherOperation = {
  query: string
  operationName?: string
  variables?: { [key: string]: any }
  context?: { [key: string]: any }
}

/**
 * The purpose of the class is to be able to "switch out" links/fetchers
 * without the need to re-run `makeExecutableSchema` which is expensive to run
 */
export class ExecutableSchemaFactory {
  private fetcher: Fetcher
  private introspectionSchema: GraphQLSchema
  private executableSchema: GraphQLSchema

  constructor(introspectionSchema: GraphQLSchema, link: ApolloLink) {
    this.introspectionSchema = introspectionSchema
    this.fetcher = linkToFetcher(link)
    this.init()
  }

  getSchema(): GraphQLSchema {
    return this.executableSchema
  }

  setLink(link: ApolloLink): void {
    this.fetcher = linkToFetcher(link)
  }

  private init(): void {
    const queryType = this.introspectionSchema.getQueryType()
    const queries = queryType.getFields()
    const queryResolvers: IResolverObject = {}
    Object.keys(queries).forEach(key => {
      // the following line was modified
      queryResolvers[key] = this.createResolver()
    })
    let mutationResolvers: IResolverObject = {}
    const mutationType = this.introspectionSchema.getMutationType()
    if (mutationType) {
      const mutations = mutationType.getFields()
      Object.keys(mutations).forEach(key => {
        // the following line was modified
        mutationResolvers[key] = this.createResolver()
      })
    }

    const resolvers: IResolvers = { [queryType.name]: queryResolvers }

    if (!isEmptyObject(mutationResolvers)) {
      resolvers[mutationType.name] = mutationResolvers
    }

    const typeMap = this.introspectionSchema.getTypeMap()
    const types = Object.keys(typeMap).map(name => typeMap[name])
    for (const type of types) {
      if (
        type instanceof GraphQLInterfaceType ||
        type instanceof GraphQLUnionType
      ) {
        resolvers[type.name] = {
          __resolveType(parent, context, info) {
            return resolveFromParentTypename(parent, info.introspectionSchema)
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
          resolvers[type.name] = createPassThroughScalar(type)
        }
      } else if (
        type instanceof GraphQLObjectType &&
        type.name.slice(0, 2) !== '__' &&
        type !== queryType &&
        type !== mutationType
      ) {
        const resolver = {}
        Object.keys(type.getFields()).forEach(field => {
          resolver[field] = defaultMergedResolver
        })
        resolvers[type.name] = resolver
      }
    }

    const typeDefs = printSchema(this.introspectionSchema)

    this.executableSchema = makeExecutableSchema({
      typeDefs,
      resolvers,
    })
  }

  private createResolver(): GraphQLFieldResolver<any, any> {
    return async (root, args, context, info) => {
      const fragments = Object.keys(info.fragments).map(
        fragment => info.fragments[fragment],
      )
      const document = {
        kind: Kind.DOCUMENT,
        definitions: [info.operation, ...fragments],
      }
      const result = await this.fetcher({
        query: print(document),
        variables: info.variableValues,
        context: { graphqlContext: context },
      })
      return checkResultAndHandleErrors(result, info)
    }
  }
}

function createPassThroughScalar({
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
      return parseLiteral(ast)
    },
  })
}

function parseLiteral(ast: ValueNode): any {
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
        value[field.name.value] = parseLiteral(field.value)
      })

      return value
    }
    case Kind.LIST: {
      return ast.values.map(parseLiteral)
    }
    default:
      return null
  }
}
