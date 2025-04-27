// price-fetcher/test_connection.js
require('dotenv').config(); // Load .env variables first
const { MongoClient, ServerApiVersion } = require('mongodb');

const uri = process.env.MONGO_URI;

if (!uri) {
    console.error("MONGO_URI not found in .env file!");
    process.exit(1);
}

console.log("Using Native Driver to test connection with URI:", uri);

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    console.log("Attempting to connect using MongoClient...");
    await client.connect();
    console.log("MongoClient connected successfully.");

    // Send a ping to confirm a successful connection
    // IMPORTANT: Use the database name from your URI if specified, otherwise default to 'admin'
    const dbName = uri.includes('.net/') ? uri.substring(uri.indexOf('.net/') + 5, uri.indexOf('?')) : 'admin';
    console.log(`Pinging database: ${dbName}...`); // Make sure this dbName matches your URI!
    await client.db(dbName).command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

  } catch(err) { 
    
      console.error("!!! Native Driver Connection Test FAILED !!!");
      console.error("Error:", err); // Print the full error
      if (err.message) {
        console.error("Error message:", err.message);
      }
      if (err.codeName) {
          console.error("Error codeName:", err.codeName); // Often 'AtlasError' or similar
      }
  } finally {
    // Ensures that the client will close when you finish/error
    console.log("Closing MongoClient connection...");
    await client.close();
    console.log("MongoClient connection closed.");
  }
}

run(); // Execute the test function
