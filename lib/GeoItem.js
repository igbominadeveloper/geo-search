const AWS = require('aws-sdk');
const ddb = new AWS.DynamoDB();
const DYNAMO_CLIENT = require('aws-sdk/clients/dynamodb');
const documentClient = new DYNAMO_CLIENT.DocumentClient();
const Geocodio = require('geocodio-library-node');
const ddbGeo = require('dynamodb-geo');
const httpStatusCode = require('http-status-codes');
const short = require('short-uuid');
const { GraphQLError } = require('graphql');
let response;

const createItem = async (root, args, context) => {
  const { item } = args;

  if (!item.name || !item.address) {
    response = {
      statusCode: httpStatusCode.StatusCodes.BAD_REQUEST,
      body: JSON.stringify({
        message: 'A name and address are required.',
      }),
    };

    return response;
  }

  const geoData = await geocodeItem(item);

  if (geoData) {
    await saveGeolocationMetadata(geoData);
    response = {
      statusCode: httpStatusCode.StatusCodes.CREATED,
      body: JSON.stringify({ id: geoData.RangeKeyValue.S }),
    };
  } else {
    response = {
      statusCode: httpStatusCode.StatusCodes.INTERNAL_SERVER_ERROR,
      body: JSON.stringify({
        message: 'An error occurred trying to save the item',
      }),
    };
  }

  return response.body;
};

/**
 * Attempt to geocode an item's address and add it to the database
 * @param {any} item - Item details from the request body
 * @return {string} - Generated id for the item
 */
async function geocodeItem(item) {
  const coords = await geocodeAddress(item.address);
  if (!coords) {
    return;
  }

  try {
    const config = new ddbGeo.GeoDataManagerConfiguration(
      ddb,
      process.env.DYNAMODB_TABLE
    );
    config.hashKeyLength = 5;

    const geoTableManager = new ddbGeo.GeoDataManager(config);

    const id = short.generate();
    const geoData = {
      RangeKeyValue: { S: id },
      GeoPoint: {
        latitude: coords.lat,
        longitude: coords.lng,
      },
      PutItemInput: {
        Item: {
          name: { S: item.name },
          address: { S: item.address },
        },
      },
    };

    await geoTableManager.putPoint(geoData).promise();

    return geoData;
  } catch (err) {
    console.log('An error occurred adding coordinates to Dynamo');
    console.log(err);
  }
}

/**
 * Save metadata about the item we are saving. Dynamodb-geo has a
 * limitation with updating existing points. So we need to be able
 * to lookup the data for any PUTs
 * @param {any} geoData - All data passed into dynamodb-geo
 */
async function saveGeolocationMetadata(geoData) {
  try {
    let hash = Number(geoData.RangeKeyValue.S.replace(/\D/g, ''));
    const params = {
      TableName: process.env.DYNAMODB_TABLE,
      Item: {
        hashKey: hash,
        rangeKey: geoData.RangeKeyValue.S,
        GeoPoint: geoData.GeoPoint,
      },
    };

    await documentClient
      .put(params)
      .promise()
      .then((response) => {
        console.log({ response });
      })
      .catch((error) => console.log({ error }));
  } catch (err) {
    console.log('An error occurred saving the geolocation metadata');
    console.log(err);
  }
}

const getItems = async (root, args, context) => {
  const DefaultRadius = 5000;
  let response;
  let coords;

  if (args.location.address) {
    const geoCoords = await geocodeAddress(args.location.address);
    coords = {
      latitude: geoCoords.lat,
      longitude: geoCoords.lng,
      radius: args.location.radius
        ? Number(args.location.radius)
        : DefaultRadius,
    };
  } else {
    coords = parseCoordinates(args);
  }
  if (!coords) {
    throw new GraphQLError('Unable to parse the input coordinates and radius');
  }

  const items = await runGeosearch(coords);

  const transformedItems = transformItems(items);

  return transformedItems;
};

/**
 * Search for items in Dynamo based on coordinates
 * @param {any} coords - Coordinates with radius for search
 * @return {Array} Found items based on coordinates
 */
async function runGeosearch(coords) {
  try {
    const config = new ddbGeo.GeoDataManagerConfiguration(
      ddb,
      process.env.DYNAMODB_TABLE
    );
    config.hashKeyLength = 5;
    const geoTableManager = new ddbGeo.GeoDataManager(config);
    const query = {
      RadiusInMeter: coords.radius,
      CenterPoint: {
        latitude: coords.latitude,
        longitude: coords.longitude,
      },
    };
    const items = await geoTableManager.queryRadius(query);
    return items;
  } catch (err) {
    console.log('An error occurred while searching DynamoDB');
    console.log(err);
  }
}

function parseCoordinates(args) {
  if (!args.location.lat || !args.location.lng) {
    return;
  }

  let coords;

  try {
    coords = {
      latitude: Number(args.location.lat),
      longitude: Number(args.location.lng),
      radius: args.location.radius
        ? Number(args.location.radius)
        : DefaultRadius,
    };
  } catch (err) {
    console.log(
      'The request did not have the correct query ' +
        'parameters or they were the wrong type'
    );
  }

  return coords;
}

/**
 * Transform the raw item values to workable objects
 * @param {Array} items - Array of raw geo data for matching items
 * @return {Array} Transformed data transfer items
 */
function transformItems(items) {
  const transformedItems = [];
  if (items) {
    items.map((item) => {
      try {
        const coords = JSON.parse(item.geoJson.S);
        const transformedItem = {
          id: item.rangeKey.S,
          name: item.name.S,
          address: item.address.S,
          coords: {
            lat: Number(coords.coordinates[1]),
            lng: Number(coords.coordinates[0]),
          },
        };

        transformedItems.push(transformedItem);
      } catch (err) {}
    });
  }

  return transformedItems;
}

/**
 * Uses Geocodio to geocode a specific address
 * @param {string} address - Address (line 1, line 2, city, state, zip) you want to geocode
 * @return {any} - Coordinates of the address passed in
 */
async function geocodeAddress(address) {
  let coords;
  try {
    const geocoder = new Geocodio(process.env.GEOCODE_API_KEY);
    const response = await geocoder.geocode(address);

    if (response && response.results && response.results.length > 0) {
      // Results are returned with highest likelihood first, so grab the first one
      coords = response.results[0].location;
    }
  } catch (err) {
    console.log('An error occurred while geocoding the address: ' + address);
    console.log(err);
  }

  return coords;
}

module.exports = {
  createItem,
  getItems,
};
