import { GraphQLServer } from 'graphql-yoga'
import { fetchTypeDefs, Remote, collectTypeDefs, GraphcoolLink } from '../src'
import * as jwt from 'jsonwebtoken'

async function run() {

  const makeLink = () => new GraphcoolLink(process.env.GRAPHCOOL_SERVICE_ID, process.env.GRAPHCOOL_TOKEN)

  const graphcoolTypeDefs = await fetchTypeDefs(makeLink())

  const typeDefs = collectTypeDefs(graphcoolTypeDefs, `
    type Query {
      me: User
      posts: [Post!]!
    }
    type Mutation {
      signup(email: String!, password: String!): AuthPayload
    }
    type AuthPayload {
      token: String!
      user: User!
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
      posts: (parent, args, ctx, info) => {
        return ctx.remote.delegateQuery('allPosts', {}, {}, info)
      }
    },
    Mutation: {
      signup: async (parent, args, ctx, info) => {
        const mutation = `
        mutation ($email: String!, $password: String!) {
          createUser(email: $email, password: $password) {
            id
            createdAt
            email
            password
            name
          }
        }`
        const result = await ctx.remote.request(mutation, args)
        return result.createUser
      },
    },
    AuthPayload: {
      token: parent => {
        const jwtTokenPayload = { userId: parent.id }
        return jwt.sign(jwtTokenPayload, process.env.JWT_SECRET!)
      },
      user: parent => parent
    },
    Post: {
      title: (parent) => {
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
    options: {
      port: 3500,
    },
    context: params => ({ ...params, remote: new Remote(makeLink(), {typeDefs}) })
  })

  server.start().then(() => console.log('Server is running on :4000'))
}

run()
