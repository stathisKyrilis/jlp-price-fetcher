// server.js
import mongoose from 'mongoose'; // Use import if package.json has "type": "module", otherwise use require('mongoose')
import dotenv from 'dotenv'; // Use import if package.json has "type": "module", otherwise use require('dotenv')
import { startFetching, stopFetching } from './services/jupiterFetcher.js'; // Adjust path and use .js if needed; use require if not using ES Modules

// Load environment variables from .env file (mainly for local dev)
// Render uses its own environment variable system
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 5001; // Render provides PORT, but good to have default

if (!MONGO_URI) {
  console.error("FATAL ERROR: MONGO_URI environment variable is not defined.");
  process.exit(1);
}

// --- Database Connection ---
const connectDB = async () => {
  try {
    console.log('Attempting to connect to MongoDB...');
    await mongoose.connect(MONGO_URI, {
       // Add options based on mongoose version if needed, but often defaults are fine
       // serverSelectionTimeoutMS: 5000 // Example
    });
    console.log('MongoDB Connected Successfully.');

    // --- Start Fetching AFTER DB Connection ---
    startFetching();

  } catch (err) {
    console.error('MongoDB Connection Error:', err.message);
    // Exit process with failure if DB connection fails
    process.exit(1);
  }
};

// Handle Mongoose connection events (optional but good practice)
mongoose.connection.on('error', err => {
  console.error('MongoDB runtime error:', err);
  // Optionally try to stop fetcher or handle reconnection
  stopFetching(); // Stop fetching if DB connection is lost
});

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected.');
  stopFetching(); // Stop fetching if DB connection is lost
  // Optionally add reconnection logic here or rely on MongoDB driver's retry mechanism
});

// --- Start the Application ---
connectDB();

// --- Optional: Simple HTTP Server (for Render health checks) ---
// Render often needs a web process to bind to a port for health checks,
// even for background workers sometimes.
// You might not need this if Render's background worker type doesn't require it.
/*
import http from 'http'; // Use require('http') if not using ES Modules

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});
*/

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
  console.log('SIGINT signal received. Stopping fetcher and closing DB connection...');
  stopFetching(); // Attempt final save
  await mongoose.connection.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received. Stopping fetcher and closing DB connection...');
  stopFetching(); // Attempt final save
  await mongoose.connection.close();
  console.log('MongoDB connection closed.');
  process.exit(0);
});