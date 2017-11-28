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

import { GraphQLResolveInfo, responsePathAsArray } from 'graphql'
import { locatedError } from 'graphql/error'

const ERROR_SYMBOL = Symbol('subSchemaErrors')

export function annotateWithChildrenErrors(
  object: any,
  childrenErrors: Array<{ path?: Array<string | number> }>,
): any {
  if (childrenErrors && childrenErrors.length > 0) {
    if (Array.isArray(object)) {
      const byIndex = {}
      childrenErrors.forEach(error => {
        const index = error.path[1]
        const current = byIndex[index] || []
        current.push({
          ...error,
          path: error.path.slice(1),
        })
        byIndex[index] = current
      })
      return object.map((item, index) =>
        annotateWithChildrenErrors(item, byIndex[index]),
      )
    } else {
      return {
        ...object,
        [ERROR_SYMBOL]: childrenErrors.map(error => ({
          ...error,
          path: error.path.slice(1),
        })),
      }
    }
  } else {
    return object
  }
}

export function getErrorsFromParent(
  object: any,
  fieldName: string,
):
  | {
      kind: 'OWN'
      error: any
    }
  | {
      kind: 'CHILDREN'
      errors?: Array<{ path?: Array<string | number> }>
    } {
  const errors = (object && object[ERROR_SYMBOL]) || []
  const childrenErrors: Array<{ path?: Array<string | number> }> = []
  for (const error of errors) {
    if (error.path.length === 1 && error.path[0] === fieldName) {
      return {
        kind: 'OWN',
        error,
      }
    } else if (error.path[0] === fieldName) {
      childrenErrors.push(error)
    }
  }
  return {
    kind: 'CHILDREN',
    errors: childrenErrors,
  }
}

export function checkResultAndHandleErrors(
  result: any,
  info: GraphQLResolveInfo,
  responseKey?: string,
): any {
  if (!responseKey) {
    responseKey = info.fieldNodes[0].alias
      ? info.fieldNodes[0].alias.value
      : info.fieldName
  }
  if (result.errors && (!result.data || result.data[responseKey] == null)) {
    const errorMessage = result.errors
      .map((error: { message: string }) => error.message)
      .join('\n')
    throw locatedError(
      errorMessage,
      info.fieldNodes,
      responsePathAsArray(info.path),
    )
  } else {
    let resultObject = result.data[responseKey]
    if (result.errors) {
      resultObject = annotateWithChildrenErrors(
        resultObject,
        result.errors as Array<{ path?: Array<string> }>,
      )
    }
    return resultObject
  }
}
