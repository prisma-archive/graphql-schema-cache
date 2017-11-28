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

import { GraphQLFieldResolver, responsePathAsArray } from 'graphql';
import { locatedError } from 'graphql/error';
import { getErrorsFromParent, annotateWithChildrenErrors } from './errors';

// Resolver that knows how to:
// a) handle aliases for proxied schemas
// b) handle errors from proxied schemas
const defaultMergedResolver: GraphQLFieldResolver<any, any> = (
  parent,
  args,
  context,
  info,
) => {
  const responseKey = info.fieldNodes[0].alias
    ? info.fieldNodes[0].alias.value
    : info.fieldName;
  const errorResult = getErrorsFromParent(parent, responseKey);
  if (errorResult.kind === 'OWN') {
    throw locatedError(
      errorResult.error.message,
      info.fieldNodes,
      responsePathAsArray(info.path),
    );
  } else if (parent) {
    let result = parent[responseKey];
    if (errorResult.errors) {
      result = annotateWithChildrenErrors(result, errorResult.errors);
    }
    return result;
  } else {
    return null;
  }
};

export default defaultMergedResolver;
