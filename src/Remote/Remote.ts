import { introspectSchema, makeExecutableSchema } from 'graphql-tools'
import {
  DocumentNode,
  execute,
  ExecutionResult,
  graphql,
  GraphQLResolveInfo,
  GraphQLSchema,
  Kind,
  printSchema,
  subscribe,
  InlineFragmentNode,
  print,
  FieldNode,
  OperationDefinitionNode,
} from 'graphql'
import { MergeInfo } from 'graphql-tools/dist/stitching/mergeSchemas'
import { Options, Variables } from 'batched-graphql-request/dist/src/types'
import { HybridLink } from '../HybridLink'
import { RemoteSchemaFactory } from './RemoteSchemaFactory'
import { Args, Context } from '../types'
import { createDocument } from './utils'
import { checkResultAndHandleErrors } from './errors'
import TypeRegistry from 'graphql-tools/dist/stitching/TypeRegistry'
export { Options } from 'batched-graphql-request/dist/src/types'
import { $$asyncIterator } from 'iterall'

const cache: { [key: string]: GraphQLSchema } = {}

let remoteSchemaFactory: RemoteSchemaFactory

export class Remote {
  private mergeInfo: MergeInfo
  private options?: Options
  private clientSchema: GraphQLSchema
  private remoteSchema: GraphQLSchema
  private link: HybridLink
  private fragments?: string
  private typeRegistry: TypeRegistry
  private initPromise: Promise<void> = Promise.resolve()
  private start: number

  constructor(
    linkOrSchema: HybridLink | GraphQLSchema,
    options?: { fragments?: any; typeDefs?: string },
  ) {
    this.fragments = options.fragments
    this.typeRegistry = new TypeRegistry()
    this.start = Date.now()

    if (linkOrSchema instanceof HybridLink) {
      if (!cache[linkOrSchema.uri]) {
        if (options.typeDefs) {
          cache[linkOrSchema.uri] = makeExecutableSchema({
            typeDefs: options.typeDefs,
          })
        } else {
          throw new TypeError(
            `Missing typeDefs for url ${
              linkOrSchema.uri
            }. Please first execute 'await fetchTypeDefs()'`,
          )
        }
      }

      this.link = linkOrSchema
    } else {
      this.remoteSchema = linkOrSchema
    }

    if (options.fragments) {
      this.addFragments(options.fragments)
    }

    this.initPromise = this.init()
  }

  private init(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      if (this.remoteSchema) {
        return resolve()
      }

      this.clientSchema =
        cache[this.link.uri] || (await introspectSchema(this.link))
      if (!remoteSchemaFactory) {
        remoteSchemaFactory = new RemoteSchemaFactory(
          this.clientSchema,
          this.link,
        )
      } else {
        remoteSchemaFactory.setLink(this.link)
      }
      this.remoteSchema = remoteSchemaFactory.getSchema()

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

  request<T>(
    query: string,
    variables?: Variables,
    operationName?: string,
  ): Promise<T> {
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

  getTypeRegistry(): TypeRegistry {
    return this.typeRegistry
  }

  getSchema(): GraphQLSchema {
    return this.remoteSchema
  }

  private async delegate(
    operation: 'query' | 'mutation' | 'subscription',
    fieldName: string,
    args: { [key: string]: any },
    context: { [key: string]: any },
    info: GraphQLResolveInfo,
  ): Promise<ExecutionResult> {
    const { document, variableValues } = extractDocumentAndVariableValues(
      operation,
      fieldName,
      args,
      context,
      info,
      this.remoteSchema,
      this.typeRegistry.fragmentReplacements,
    )

    const result = await execute(
      this.remoteSchema,
      document,
      info.rootValue,
      context,
      variableValues,
    )
    return checkResultAndHandleErrors(result, info, fieldName)
  }

  async delegateQuery(
    fieldName: string,
    args: Args,
    context: Context,
    info: GraphQLResolveInfo,
  ): Promise<ExecutionResult> {
    await this.initPromise
    return this.delegate('query', fieldName, args, context, info)
  }

  async delegateMutation(
    fieldName: string,
    args: Args,
    context: Context,
    info: GraphQLResolveInfo,
  ): Promise<ExecutionResult> {
    await this.initPromise
    return this.delegate('mutation', fieldName, args, context, info)
  }

  async delegateSubscription(
    fieldName: string,
    args: Args,
    context: Context,
    info: GraphQLResolveInfo,
  ): Promise<AsyncIterator<ExecutionResult> | ExecutionResult> {
    await this.initPromise
    const { document, variableValues } = extractDocumentAndVariableValues(
      'subscription',
      fieldName,
      args,
      context,
      info,
      this.remoteSchema,
      this.typeRegistry.fragmentReplacements,
    )

    const iterator = (await subscribe(
      this.remoteSchema,
      document,
      info.rootValue,
      context,
      variableValues,
    )) as any

    return {
      async next() {
        const { value } = await iterator.next()
        return { value: value.data, done: false }
      },
      return() {
        return Promise.resolve({ value: undefined, done: true })
      },
      throw(error) {
        return Promise.reject(error)
      },
      [$$asyncIterator]() {
        return this
      },
    }
  }
}

export async function fetchTypeDefs(link: HybridLink) {
  const schema = await introspectSchema(link)
  cache[link.uri] = schema

  return printSchema(schema)
}

export function extractDocumentAndVariableValues(
  operation: 'query' | 'mutation' | 'subscription',
  fieldName: string,
  args: { [key: string]: any },
  context: { [key: string]: any },
  info: GraphQLResolveInfo,
  remoteSchema: GraphQLSchema,
  fragmentReplacements: {
    [typeName: string]: {
      [fieldName: string]: InlineFragmentNode
    }
  },
): {
  document: DocumentNode
  variableValues?: any
} {
  let type
  if (operation === 'query') {
    type = remoteSchema.getQueryType()
  } else if (operation === 'mutation') {
    type = remoteSchema.getMutationType()
  } else if (operation === 'subscription') {
    type = remoteSchema.getSubscriptionType()
  }

  if (!type) {
    throw new TypeError('Could not forward to remote schema')
  }

  const document: DocumentNode = createDocument(
    remoteSchema,
    fragmentReplacements,
    type,
    fieldName,
    operation,
    info.fieldNodes,
    info.fragments,
    info.operation ? info.operation.variableDefinitions : [],
  )

  const operationDefinition = document.definitions.find(
    ({ kind }) => kind === Kind.OPERATION_DEFINITION,
  ) as OperationDefinitionNode
  let variableValues = {}
  if (operationDefinition && operationDefinition.variableDefinitions) {
    operationDefinition.variableDefinitions.forEach(definition => {
      const key = definition.variable.name.value
      // (XXX) This is kinda hacky
      let actualKey = key
      if (actualKey.startsWith('_')) {
        actualKey = actualKey.slice(1)
      }
      const value = args[actualKey] || args[key] || info.variableValues[key]
      variableValues[key] = value
    })
  }

  // override arguments
  if (operationDefinition) {
    // implement just for root level (mutations) for now
    operationDefinition.selectionSet.selections
      .filter(s => s.kind === Kind.FIELD)
      .forEach((field: FieldNode) => {
        field.arguments.forEach(arg => {
          const newValue = args[arg.name.value]
          if (newValue === null) {
            arg.value = { kind: 'NullValue' }
          } else if (
            newValue !== undefined &&
            arg.value.kind !== 'Variable' &&
            arg.value.kind !== 'ObjectValue' &&
            arg.value.kind !== 'NullValue' &&
            arg.value.kind !== 'ListValue'
          ) {
            arg.value.value = newValue
          }
        })
      })
  }

  return {
    document,
    variableValues,
  }
}
