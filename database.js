const { MongoClient } = require('mongodb');

const url = process.env.DB_URL;
const connectDB = new MongoClient(url).connect();

module.exports = connectDB