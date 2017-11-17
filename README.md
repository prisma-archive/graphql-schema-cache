# graphql-remote
A toolbelt for creating remote GraphQL schemas.

## Install

```sh
yarn add graphql-remote
```

## Usage

### API

```ts
import { GraphQLServer } from 'graphql-yoga'
import { fetchTypeDefs, RemoteSchema, collectTypeDefs, GraphcoolLink } from 'graphql-remote-tmp'
import * as jwt from 'jsonwebtoken'

async function run() {

  const makeLink = () => new GraphcoolLink(process.env.GRAPHCOOL_SERVICE_ID, process.env.GRAPHCOOL_TOKEN)

  const graphcoolTypeDefs = await fetchTypeDefs(makeLink())

  const typeDefs = collectTypeDefs(graphcoolTypeDefs, `
    type Query {
      me: User
    }
    type Subscription {
      Post: PostSubscriptionPayload
    }
    type Post {
      id: ID!
      title: String!
      secret: Boolean
      extra: String
      allPosts: [Post!]!
      comments(filter: CommentFilter): [Comment!]
    }
    
    input CommentFilter {
      text_not: String
    }
  `)

  const resolvers = {
    Query: {
      me: (parent, args, ctx, info) => {
        const token = ctx.request.get('Authorization').replace('Bearer ', '')
        const { userId } = jwt.verify(token, process.env.JWT_SECRET!) as {
          userId: string
        }
        return ctx.graphcool.delegateQuery('User', { id: userId }, {}, info)
      },
    },
    Post: {
      title: (parent) =>  {
        return parent.title + ' - Post Title'
      },
      extra: () => 'extra field',
      allPosts: (_, _2, ctx, info) => {
        return ctx.graphcool.delegateQuery('allPosts', {}, {}, info)
      }
    },
    Subscription: {
      Post: {
        subscribe: async (parent, args, ctx, info) => {
          return ctx.graphcool.delegateSubscription('Post', args, ctx, info)
        },
      },
    },
  }

  const server = new GraphQLServer({
    typeDefs,
    resolvers,
    context: params => ({ ...params, graphcool: new RemoteSchema(makeLink()) }),
  })

  server.start().then(() => console.log('Server is running on :4000'))
}

run()
```
