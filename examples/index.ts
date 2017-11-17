import { GraphQLServer } from 'graphql-yoga'
import { HttpLink } from 'apollo-link-http'
import fetch from 'node-fetch'
import { RemoteSchema, collectTypeDefs, fetchTypeDefs } from 'graphql-remote'

async function run() {
  const makeLink = () => new HttpLink({
    uri: 'https://api.graph.cool/simple/v1/cizfapt9y2jca01393hzx96w9',
    fetch,
    headers: { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` },
  })

  const graphcoolTypeDefs = await fetchTypeDefs(makeLink())

  const typeDefs = collectTypeDefs(graphcoolTypeDefs, `
    type Query {
      messages: [Message!]!
    }
  `)

  const resolvers = {
    Query: {
      messages: async (parent, args, context, info) => {
        return context.graphcool.delegateQuery('allMessages', {}, context, info)
      },
    },
  }

  const server = new GraphQLServer({
    typeDefs, resolvers,
    context: req => ({ req, graphcool: new RemoteSchema(makeLink()) })
  })
  server.start(() => console.log('Server is running on localhost:3000'))
}

run().catch(console.log.bind(console))
