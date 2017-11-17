import {
  introspectSchema,
  makeRemoteExecutableSchema,
  mergeSchemas,
} from 'graphql-tools'
import {
  DefinitionNode,
  DocumentNode,
  GraphQLResolveInfo,
  GraphQLSchema,
  ObjectTypeDefinitionNode,
  parse,
  print,
  printSchema,
} from 'graphql'
import { ApolloLink } from 'apollo-link'
import { MergeInfo } from 'graphql-tools/dist/stitching/mergeSchemas'
import * as _ from 'lodash'

export type Delegator = (
  type: 'query' | 'mutation',
  fieldName: string,
  args: { [key: string]: any },
  context: { [key: string]: any },
  info: GraphQLResolveInfo,
) => any

export interface DefinitionMap {
  [key: string]: DefinitionNode
}

const builtinTypes = ['String', 'Float', 'Int', 'Boolean', 'ID']

export async function fetchTypeDefs(link: ApolloLink): Promise<string> {
  const schema = await introspectSchema(link)
  return printSchema(schema)
}

export function collectTypeDefs(baseSchemaIdl: string, typeDefs: string): string {
  let patchedTypeDef = extractMissingTypesStep(typeDefs, baseSchemaIdl)
  let count = 0
  // do a maximum of 50 iterations to ensure no recursive call is being executed
  while (count < 50) {
    const newTypeDef = extractMissingTypesStep(patchedTypeDef, baseSchemaIdl)
    if (newTypeDef === patchedTypeDef) {
      return newTypeDef
    }
    patchedTypeDef = newTypeDef
    count++
  }
  return patchedTypeDef
}

function extractMissingTypesStep(typeDefs: string, baseSchemaIdl: string): string {
  const baseSchemaAst = parse(baseSchemaIdl)

  const customSchemaAst = parse(typeDefs)
  patchMissingTypes(customSchemaAst, baseSchemaAst)

  return print(customSchemaAst)
}

function patchMissingTypes(
  definitionsAst: DocumentNode,
  schemaAst: DocumentNode,
) {
  const schemaMap: DefinitionMap = _.keyBy(
    schemaAst.definitions,
    (d: any) => d.name.value,
  )
  definitionsAst.definitions.forEach(def =>
    patchDefinition(definitionsAst, def, schemaMap),
  )
}

function getDeeperType(type: any, depth: number = 0): any {
  if (depth < 5) {
    if (type.ofType) {
      return getDeeperType(type.ofType, depth + 1)
    } else if (type.type) {
      return getDeeperType(type.type, depth + 1)
    }
  }
  return type
}

function patchDefinition(
  definitionsAst: DocumentNode,
  definition: DefinitionNode,
  schemaMap: DefinitionMap,
) {
  if (definition.kind === 'ObjectTypeDefinition') {
    const def: ObjectTypeDefinitionNode = definition
    def.fields.forEach(field => {
      const deeperType = getDeeperType(field.type)
      if (deeperType.kind === 'NamedType') {
        const typeName = deeperType.name.value
        field.arguments.forEach(argument => {
          const argType = getDeeperType(argument)
          const argTypeName = argType.name.value
          if (
            !definitionsAst.definitions.find(
              (d: any) => d.name && d.name.value === argTypeName,
            ) &&
            !builtinTypes.includes(argTypeName)
          ) {
            const argTypeMatch = schemaMap[argTypeName]
            if (!argTypeMatch) {
              throw new Error(
                `Field ${field.name
                  .value}: Couldn't find type ${argTypeName} of args in typeDefinitions or baseSchema.`,
              )
            }
            definitionsAst.definitions.push(argTypeMatch)
          }
        })
        if (
          !definitionsAst.definitions.find(
            (d: any) => d.name && d.name.value === typeName,
          ) &&
          !builtinTypes.includes(typeName)
        ) {
          const schemaType: ObjectTypeDefinitionNode = schemaMap[
            typeName
          ] as ObjectTypeDefinitionNode
          if (!schemaType) {
            throw new Error(
              `Field ${field.name
                .value}: Couldn't find type ${typeName} in typeDefinitions or baseSchema.`,
            )
          }
          definitionsAst.definitions.push(schemaType)
          if (schemaType.interfaces) {
            schemaType.interfaces.forEach(i => {
              const name = i.name.value
              const exists = definitionsAst.definitions.find(
                (d: any) => d.name && d.name.value === name,
              )
              if (!exists) {
                const interfaceType = schemaMap[name]
                if (!interfaceType) {
                  throw new Error(
                    `Field ${field.name
                      .value}: Couldn't find interface ${name} in baseSchema for type ${typeName}.`,
                  )
                }
                definitionsAst.definitions.push(interfaceType)
              }
            })
          }
        }
      }
    })
  }
}

export class RemoteSchema {
  link: ApolloLink
  schema: GraphQLSchema
  mergeInfo: MergeInfo

  private initialPromise: Promise<void>

  constructor(link: ApolloLink) {
    this.link = link
    this.initialPromise = this.init()
  }

  init(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      const { link } = this
      this.schema = makeRemoteExecutableSchema({
        schema: await introspectSchema(link),
        link,
      })
      mergeSchemas({
        schemas: [this.schema],
        resolvers: mergeInfo => {
          this.mergeInfo = mergeInfo
          resolve()
          return {}
        },
      })
    })
  }

  async delegateQuery(queryPath: string, args: any, context: any, info: any): Promise<any> {
    await this.initialPromise
    return this.mergeInfo.delegate('query', queryPath, args, context, info)
  }

  async delegateMutation(queryPath: string, args: any, context: any, info: any): Promise<any> {
    await this.initialPromise
    return this.mergeInfo.delegate('mutation', queryPath, args, context, info)
  }

}
