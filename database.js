const { MongoClient } = require('mongodb');

const url = process.env.DB_URL;
const client = new MongoClient(url, {
	maxPoolSize: 10,
	maxIdleTimeMS: 60_000
});
const connectDB = client.connect();

module.exports = connectDB