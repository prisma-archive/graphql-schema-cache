import {
  introspectSchema,
} from 'graphql-tools'
import {
  DocumentNode, execute, ExecutionResult, graphql,
  GraphQLResolveInfo,
  GraphQLSchema,
  Kind,
  printSchema,
  subscribe,
} from 'graphql'
import { MergeInfo } from 'graphql-tools/dist/stitching/mergeSchemas'
import { Options, Variables } from 'batched-graphql-request/dist/src/types'
import { HybridLink } from '../HybridLink'
import { createRemoteSchema } from './createRemoteSchema'
import { Args, Context } from '../types'
import { createDocument } from './utils'
import { checkResultAndHandleErrors } from './errors'
import TypeRegistry from 'graphql-tools/dist/stitching/TypeRegistry'
export { Options } from 'batched-graphql-request/dist/src/types'
import {$$asyncIterator} from 'iterall'

const cache: {[key: string]: GraphQLSchema} = {}

interface ExecuteInput {
  document: DocumentNode
  variableValues?: any
}

export class Remote {
  private mergeInfo: MergeInfo
  private options?: Options
  private clientSchema: GraphQLSchema
  private remoteSchema: GraphQLSchema
  private link: HybridLink
  private fragments?: string
  private typeRegistry: TypeRegistry
  private initPromise: Promise<void>

  constructor(linkOrSchema: HybridLink | GraphQLSchema, fragments?: any) {
    this.fragments = fragments
    this.typeRegistry = new TypeRegistry()
    if (linkOrSchema instanceof HybridLink) {
      if (!cache[linkOrSchema.uri]) {
        throw new TypeError(`Missing typeDefs for url ${linkOrSchema.uri}. Please first execute 'await fetchTypeDefs()'`)
      }
      this.link = linkOrSchema
    } else {
      this.remoteSchema = linkOrSchema
    }
    if (fragments) {
      this.addFragments(fragments)
    }
    this.initPromise = this.init()
  }

  private init(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.remoteSchema) {
        return resolve()
      }

      this.clientSchema = cache[this.link.uri] || await introspectSchema(this.link)
      this.remoteSchema = createRemoteSchema(this.clientSchema, this.link)

      resolve()
    })
  }

  addFragments(fragments: any) {
    Object.keys(fragments).forEach(typeName => {
      const type = fragments[typeName]
      Object.keys(type).forEach(fieldName => {
        const fragment = type[fieldName]
        this.typeRegistry.addFragment(typeName, fieldName, fragment)
      })
    })
  }

  request<T>(query: string, variables?: Variables, operationName?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      return graphql(this.remoteSchema, query, {}, {}, variables, operationName)
        .then(res => {
          if (res.errors) {
            reject(res.errors)
          }
          resolve(res.data as T)
        })
        .catch(e => {
          reject(e)
        })
    })
  }

  private prepareDelegate(operation: 'query' | 'mutation' | 'subscription', fieldName: string, args: {[key: string]: any}, context: {[key: string]: any}, info: GraphQLResolveInfo): ExecuteInput {
    let type
    if (operation === 'query') {
      type = this.remoteSchema.getQueryType()
    } else if (operation === 'mutation') {
      type = this.remoteSchema.getMutationType()
    } else if (operation === 'subscription') {
      type = this.remoteSchema.getSubscriptionType()
    }

    if (!type) {
      throw new TypeError('Could not forward to remote schema')
    }

    const document: DocumentNode = createDocument(
      this.remoteSchema,
      this.typeRegistry.fragmentReplacements,
      type,
      fieldName,
      operation,
      info.fieldNodes,
      info.fragments,
      info.operation ? info.operation.variableDefinitions : [],
    )

    const operationDefinition = document.definitions.find(
      ({ kind }) => kind === Kind.OPERATION_DEFINITION,
    );
    let variableValues = {};
    if (
      operationDefinition &&
      operationDefinition.kind === Kind.OPERATION_DEFINITION &&
      operationDefinition.variableDefinitions
    ) {
      operationDefinition.variableDefinitions.forEach(definition => {
        const key = definition.variable.name.value;
        // (XXX) This is kinda hacky
        let actualKey = key;
        if (actualKey.startsWith('_')) {
          actualKey = actualKey.slice(1);
        }
        const value = args[actualKey] || args[key] || info.variableValues[key];
        variableValues[key] = value;
      });
    }


    return {
      document,
      variableValues
    }
  }

  private async delegate(operation: 'query' | 'mutation' | 'subscription', fieldName: string, args: {[key: string]: any}, context: {[key: string]: any}, info: GraphQLResolveInfo): Promise<ExecutionResult> {
    const {document, variableValues} = this.prepareDelegate(operation, fieldName, args, context, info)

    const result = await execute(
      this.remoteSchema,
      document,
      info.rootValue,
      context,
      variableValues,
    )
    return checkResultAndHandleErrors(result, info, fieldName);
  }

  async delegateQuery(fieldName: string, args: Args, context: Context, info: GraphQLResolveInfo): Promise<ExecutionResult> {
    await this.initPromise
    return this.delegate('query', fieldName, args, context, info)
  }

  async delegateMutation(fieldName: string, args: Args, context: Context, info: GraphQLResolveInfo): Promise<ExecutionResult> {
    await this.initPromise
    return this.delegate('mutation', fieldName, args, context, info)
  }

  async delegateSubscription(fieldName: string, args: Args, context: Context, info: GraphQLResolveInfo): Promise<AsyncIterator<ExecutionResult> | ExecutionResult> {
    await this.initPromise
    const {document, variableValues} = this.prepareDelegate('subscription', fieldName, args, context, info)

    const iterator = await subscribe(
      this.remoteSchema,
      document,
      info.rootValue,
      context,
      variableValues,
    ) as any

    return {
      async next() {
        const {value} = await iterator.next()
        return {value: value.data, done: false}
      },
      return() {
        return Promise.resolve({ value: undefined, done: true })
      },
      throw(error) {
        return Promise.reject(error);
      },
      [$$asyncIterator]() {
        return this;
      },
    };
  }
}

export async function fetchTypeDefs(link: HybridLink) {
  const schema = await introspectSchema(link)
  cache[link.uri] = schema

  return printSchema(schema)
}
