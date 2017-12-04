import { GraphQLSchema } from 'graphql'
import { ApolloLink } from 'apollo-link'
import { makeExecutableSchema } from 'graphql-tools'
import { ExecutableSchemaFactory } from './RemoteSchemaFactory'

export interface SchemaCacheOptions {
  link: ApolloLink
  typeDefs: string
  key: string
}

export interface CacheElement {
  introspectionSchema: GraphQLSchema
  factory: ExecutableSchemaFactory
}

export class SchemaCache {
  cache: { [key: string]: CacheElement } = {}

  makeExecutableSchema({
    link,
    typeDefs,
    key,
  }: SchemaCacheOptions): GraphQLSchema {
    if (this.cache[key]) {
      this.cache[key].factory.setLink(link)
    } else {
      const introspectionSchema = makeExecutableSchema({ typeDefs })
      const factory = new ExecutableSchemaFactory(introspectionSchema, link)

      this.cache[key] = { introspectionSchema, factory }
    }

    return this.cache[key].factory.getSchema()
  }
}
