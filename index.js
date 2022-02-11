require('dotenv').config();
const { ApolloServer } = require('apollo-server-lambda');
const { ApolloServer: ApolloServerLocal } = require('apollo-server');
const schema = require('./graphql/federation');
const { verify } = require('@pointblankdev/lambda-auth');
const AWS = require('aws-sdk');
const ddbGeo = require('dynamodb-geo');

const environment = process.env.ENV;

const setupTable = () => {
  AWS.config.update({ region: process.argv[2] });
  const ddb = new AWS.DynamoDB();

  // Configuring constants
  const DDB_TABLENAME = process.env.DYNAMODB_TABLE;
  const config = new ddbGeo.GeoDataManagerConfiguration(ddb, DDB_TABLENAME);
  config.geohashAttributeName = 'geohash';
  config.rangeKeyAttributeName = 'rangeKey';
  config.hashKeyAttributeName = 'hashKey';

  config.hashKeyLength = 5;

  // Use GeoTableUtil to help construct a CreateTableInput.
  const createTableInput = ddbGeo.GeoTableUtil.getCreateTableRequest(config);
  createTableInput.AttributeDefinitions = [
    {
      AttributeName: 'hashKey',
      AttributeType: 'N',
    },
    {
      AttributeName: 'rangeKey',
      AttributeType: 'S',
    },
    {
      AttributeName: 'geohash',
      AttributeType: 'N',
    },
  ];

  createTableInput.KeySchema = [
    {
      AttributeName: 'hashKey',
      KeyType: 'HASH',
    },
    {
      AttributeName: 'rangeKey',
      KeyType: 'RANGE',
    },
  ];

  createTableInput.LocalSecondaryIndexes = [
    {
      IndexName: 'geohash-index',
      KeySchema: [
        {
          AttributeName: 'hashKey',
          KeyType: 'HASH',
        },
        { AttributeName: 'geohash', KeyType: 'RANGE' },
      ],
      Projection: {
        ProjectionType: 'ALL',
      },
    },
  ];

  // Tweak the schema as desired
  delete createTableInput.ProvisionedThroughput;
  createTableInput.BillingMode = 'PAY_PER_REQUEST';

  console.log('Creating table with schema:');
  console.dir(createTableInput, { depth: null });

  // Create the table
  ddb
    .createTable(createTableInput)
    .promise()
    // Wait for it to become ready
    .then(function () {
      return ddb
        .waitFor('tableExists', { TableName: config.tableName })
        .promise();
    })
    .then(function () {
      console.log('Table created and ready!');
    });
};

setupTable();

if (environment === 'local') {
  // Local development
  const server = new ApolloServerLocal({ schema });
  server.listen().then(({ url }) => {
    console.log(`🚀 Server ready at ${url}`);
  });
} else {
  // AWS Lambda
  const server = new ApolloServer({
    schema,
    context: ({ event, context }) => ({
      headers: event.headers,
      functionName: context.functionName,
      event,
      context,
      user: verify(event),
    }),
    playground: {
      endpoint: `/${environment}/graphql`,
    },
    introspection: true,
  });
  exports.handler = server.createHandler({
    cors: {
      origin: '*',
      credentials: false,
    },
  });
}
