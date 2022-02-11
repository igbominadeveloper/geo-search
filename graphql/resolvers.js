const { getItems, createItem } = require('../lib/GeoItem');

const resolvers = {
  Query: {
    getItems,
  },
  Mutation: {
    createItem,
  },
};

module.exports = resolvers;
