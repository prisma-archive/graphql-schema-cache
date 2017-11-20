# graphql-remote
A toolbelt for creating remote GraphQL schemas with built-in subscriptions and dataloader support.

## Install

```sh
yarn add graphql-remote
```

## Usage

### API

```ts
import { GraphQLServer } from 'graphql-yoga'
import { fetchTypeDefs, Remote, collectTypeDefs, GraphcoolLink } from 'graphql-remote'
import * as jwt from 'jsonwebtoken'

async function run() {

  const makeLink = () => new GraphcoolLink(process.env.GRAPHCOOL_SERVICE_ID, process.env.GRAPHCOOL_TOKEN)

  const remoteTypeDefs = await fetchTypeDefs(makeLink())

  const typeDefs = collectTypeDefs(remoteTypeDefs, `
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
        return ctx.remote.delegateQuery('User', { id: userId }, {}, info)
      },
    },
    Post: {
      title: (parent) =>  {
        return parent.title + ' - Post Title'
      },
      extra: () => 'extra field',
      allPosts: (_, _2, ctx, info) => {
        return ctx.remote.delegateQuery('allPosts', {}, {}, info)
      }
    },
    Subscription: {
      Post: {
        subscribe: async (parent, args, ctx, info) => {
          return ctx.remote.delegateSubscription('Post', args, ctx, info)
        },
      },
    },
  }

  const server = new GraphQLServer({
    typeDefs,
    resolvers,
    context: params => ({ ...params, remote: new Remote(makeLink()) }),
  })

  server.start().then(() => console.log('Server is running on :4000'))
}

run()
```

## Credits
`graphql-remote` is an extension of the awesome [`graphql-tools`](https://github.com/apollographql/graphql-tools)
