const { gql } = require('apollo-server-lambda');

const typeDefs = gql`
  # Models

  type Location {
    lat: String
    lng: String
    radius: String
  }

  type Coord {
    lat: Float
    lng: Float
  }

  type Item {
    id: String
    name: String
    address: String
    coords: Coord
  }

  input LocationInput {
    address: String
    radius: Int
  }

  input ItemInput {
    name: String
    address: String
  }

  # Operations
  type Query {
    getItems(location: LocationInput!): [Item]
  }

  type Mutation {
    createItem(item: ItemInput): String
  }
`;

module.exports = typeDefs;
