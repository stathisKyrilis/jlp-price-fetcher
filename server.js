// api/server.js
import http from 'http';
import { WebSocketServer } from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import url from 'url';

import connectDB from './config/db.js';
import { fetchPriceData, startDbSaving, stopDbSaving } from './services/jupiterFetcher.js';
import Price from './models/Price.js'; // Import model for API endpoint
import express from 'express';

dotenv.config();

const PORT = process.env.PORT || 10000; // Use Render's port or default
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'; // Default for local dev
const FETCH_INTERVAL = parseInt(process.env.FAST_FETCH_INTERVAL_MS || '1000', 10);

// --- Connect to Database ---
connectDB();

// --- Create HTTP Server ---
// We need this to handle both regular HTTP requests (API) and WebSocket upgrades
const server = http.createServer();

// --- Configure CORS for HTTP Server ---
// This is crucial for allowing requests from your frontend domain
const corsMiddleware = cors({
    origin: FRONTEND_URL, // Allow only your frontend
    methods: ['GET'],    // Allow only GET requests for the API endpoint
});

// --- Apply CORS and Handle HTTP Requests (API Endpoint) ---
server.on('request', (req, res) => {
    // Apply CORS middleware
    corsMiddleware(req, res, async () => {
        // Check if CORS preflight request or blocked
        if (req.method === 'OPTIONS' || res.headersSent) {
            // CORS middleware handles OPTIONS and responses if origin not allowed
            if (!res.headersSent) { // If CORS didn't automatically handle it (e.g., OPTIONS wasn't needed but origin still denied)
               res.writeHead(403, { 'Content-Type': 'text/plain' });
               res.end('Forbidden');
            }
            return;
        }

        const parsedUrl = url.parse(req.url, true); // true parses query string

        // --- API Endpoint: /api/getHistoricalPrices ---
        if (parsedUrl.pathname === '/api/getHistoricalPrices' && req.method === 'GET') {
            try {
                const { symbols, interval = '3m' } = parsedUrl.query; // Default interval 3m
                const endTime = new Date(); // Now
                const startTime = new Date(endTime.getTime() - 6 * 60 * 60 * 1000); // 6 hours ago

                if (!symbols) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: 'Missing required query parameter: symbols (comma-separated)' }));
                }

                const symbolArray = symbols.split(',').map(s => s.trim().toUpperCase());
                const validSymbols = ['JLP', 'SOL', 'USDC'];
                const requestedSymbols = symbolArray.filter(s => validSymbols.includes(s));

                if (requestedSymbols.length === 0) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: 'No valid symbols requested. Valid symbols are JLP, SOL, USDC.' }));
                }

                // --- Determine Aggregation Interval (MongoDB expects milliseconds or specific operators) ---
                let groupIntervalMs;
                let groupByFormat; // For grouping by time units

                // Simple interval parsing (extend as needed)
                if (interval.endsWith('m')) {
                    const minutes = parseInt(interval.slice(0, -1), 10);
                    if (!isNaN(minutes) && minutes > 0) {
                        groupIntervalMs = minutes * 60 * 1000;
                        // Group by truncated timestamp
                        groupByFormat = {
                           $subtract: [
                               { $toLong: "$timestamp" }, // Convert date to milliseconds since epoch
                               { $mod: [{ $toLong: "$timestamp" }, groupIntervalMs] } // Modulo by interval
                           ]
                        };
                    }
                } else if (interval.endsWith('h')) {
                     const hours = parseInt(interval.slice(0, -1), 10);
                     if (!isNaN(hours) && hours > 0) {
                         groupIntervalMs = hours * 60 * 60 * 1000;
                         groupByFormat = {
                            $subtract: [
                                { $toLong: "$timestamp" },
                                { $mod: [{ $toLong: "$timestamp" }, groupIntervalMs] }
                            ]
                         };
                     }
                } // Add 's' for seconds if needed

                if (!groupByFormat) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ message: 'Invalid interval format. Use format like "1m", "5m", "1h".' }));
                }

                // --- Aggregation Pipeline ---
                const pipeline = [
                    // 1. Match documents within the time range and for the requested symbols
                    {
                        $match: {
                            symbol: { $in: requestedSymbols },
                            timestamp: { $gte: startTime, $lte: endTime }
                        }
                    },
                    // 2. Sort by timestamp descending (important for $last)
                    { $sort: { timestamp: 1 } }, // Sort ascending to get first/last correctly in group
                    // 3. Group by symbol and the calculated time interval
                    {
                        $group: {
                            _id: {
                                symbol: "$symbol",
                                timeBucket: groupByFormat // Group by the start of the interval bucket
                            },
                            // Get the price from the LAST document in the bucket (approximates closing price)
                            lastPrice: { $last: "$price" },
                             // Get the timestamp of the bucket start
                            timestamp: { $first: { $toDate: "$_id.timeBucket" } } // Convert bucket start back to Date
                        }
                    },
                     // 4. Project to reshape the output
                     {
                         $project: {
                             _id: 0, // Exclude the default _id
                             symbol: "$_id.symbol",
                             price: "$lastPrice",
                             timestamp: "$timestamp"
                         }
                     },
                    // 5. Sort the final results by time
                    { $sort: { timestamp: 1 } }
                ];

                const historicalData = await Price.aggregate(pipeline);

                // --- Group results by symbol for easier frontend consumption ---
                const resultsBySymbol = {};
                requestedSymbols.forEach(sym => { resultsBySymbol[sym] = []; });
                historicalData.forEach(doc => {
                    if (resultsBySymbol[doc.symbol]) {
                        resultsBySymbol[doc.symbol].push({
                            timestamp: doc.timestamp.toISOString(), // Send ISO string
                            price: doc.price
                        });
                    }
                });


                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(resultsBySymbol));

            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error in /api/getHistoricalPrices:`, error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Internal Server Error' }));
            }
        }
        // ===> ADD THIS 'else if' BLOCK <===
        else if (parsedUrl.pathname === '/prices/historical' && req.method === 'GET') {
            try {
                const hours = 6; // Fetch last 6 hours
                const since = new Date(Date.now() - hours * 60 * 60 * 1000);

                // Fetch ONLY JLP prices within the timeframe, sorted
                const historicalData = await Price.find({
                    symbol: 'JLP', // Assuming you only save JLP now
                    timestamp: { $gte: since }
                })
                .sort({ timestamp: 1 }) // Sort ascending (oldest first)
                .limit(21600); // Limit results

                // Format exactly as the frontend expects (array of objects with 'history' key)
                 const formattedData = [{
                    symbol: 'JLP',
                    // Map to the { timestamp: ISODateString, price: number } format
                    history: historicalData.map(p => ({
                        timestamp: p.timestamp, // Keep as Date object or convert to ISO string
                        price: p.price
                    }))
                }];


                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(formattedData)); // Send the formatted data

            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error fetching historical prices (/prices/historical):`, error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Internal Server Error fetching historical price data' }));
            }
       }
       // ===> END ADDED BLOCK <===

        // --- Health Check Endpoint ---
        else if (parsedUrl.pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
        }
        // --- Handle Not Found ---
        else {
             // Let specific handlers (like WebSocket upgrade) potentially handle it
             // If no other handler takes it, it will eventually timeout or close
             if (!res.headersSent) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
             }
        }
    }); // End corsMiddleware callback
});


const app = express();

// ... other middleware (app.use(cors()), app.use(express.json()), etc.) ...

// ===> CHECK FOR THIS ROUTE <===
app.get('/prices/historical', async (req, res) => {
  try {
    // Fetch the last N hours of JLP prices from MongoDB
    // (Adjust the time range and filtering as needed)
    const hours = 6; // Example: 6 hours
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Find only JLP prices within the timeframe, sort by timestamp descending
    const historicalData = await Price.find({
      symbol: 'JLP', // Make sure you only save JLP if that's intended
      timestamp: { $gte: since }
    })
    .sort({ timestamp: -1 }) // Get latest first if needed, or sort ascending
    .limit(); // Add a limit just in case

    // Format for the frontend if necessary (or send raw data)
    // Example formatting (adapt if your frontend expects a different structure):
    const formattedData = [{
        symbol: 'JLP',
        history: historicalData.map(p => ({ timestamp: p.timestamp, price: p.price }))
    }];


    res.json(formattedData); // Send the data back as JSON

  } catch (error) {
    console.error("Error fetching historical prices:", error);
    res.status(500).json({ message: "Error fetching historical price data" });
  }
});
// ===> END CHECK <===

// --- Create WebSocket Server (attach to HTTP server) ---
const wss = new WebSocketServer({ server }); // Attach WS server to the HTTP server

console.log(`WebSocket Server created. Allowing connections from: ${FRONTEND_URL}`);

wss.on('connection', (ws, req) => {
    // --- Verify Origin ---
    // Important security measure for WebSockets
    const origin = req.headers['origin'];
    if (origin !== FRONTEND_URL) {
        console.warn(`WebSocket connection rejected from invalid origin: ${origin}`);
        ws.close(1008, 'Invalid origin'); // 1008 = Policy Violation
        return;
    }
    console.log(`[${new Date().toISOString()}] WebSocket client connected. Origin: ${origin}`);

    ws.on('message', (message) => {
        // Optional: Handle incoming messages from client if needed
        console.log(`Received message from client: ${message}`);
    });

    ws.on('close', (code, reason) => {
        console.log(`[${new Date().toISOString()}] WebSocket client disconnected. Code: ${code}, Reason: ${reason}`);
    });

    ws.on('error', (error) => {
        console.error(`[${new Date().toISOString()}] WebSocket error:`, error);
        // Ensure connection is closed on error
        if (ws.readyState === ws.OPEN) {
            ws.close();
        }
    });
});

// --- Broadcast Function ---
// Sends data to all connected WebSocket clients
function broadcast(data) {
    const jsonData = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === client.OPEN) { // Check if client is ready
            client.send(jsonData, (err) => {
                if (err) {
                    console.error(`[${new Date().toISOString()}] Error sending message to client:`, err);
                    // Optional: Terminate broken connections
                    // if (client.readyState !== client.CLOSING && client.readyState !== client.CLOSED) {
                    //    client.terminate();
                    // }
                }
            });
        }
    });
}

// --- Orchestrate Fetching and Broadcasting ---
let fetchIntervalId = null;

const runFetcher = async () => {
  try {
    const fetchedPrices = await fetchPriceData(); // Get prices from this run
    if (fetchedPrices && fetchedPrices.length > 0) {
      // Broadcast only the newly fetched prices
      broadcast({ type: 'PRICE_UPDATE', payload: fetchedPrices });
    }
  } catch (error) {
      // Catch any unexpected error from fetchPriceData itself (should be handled within, but belt-and-suspenders)
      console.error(`[${new Date().toISOString()}] Error in runFetcher loop:`, error);
  } finally {
      // Schedule the next fetch regardless of success/failure of the current one
      if (fetchIntervalId) { // Ensure interval is still supposed to be running
          // Using setTimeout ensures that fetches happen roughly FETCH_INTERVAL apart,
          // even if a fetch takes longer than the interval.
          fetchIntervalId = setTimeout(runFetcher, FETCH_INTERVAL);
      }
  }
};


const startFetching = () => {
    if (fetchIntervalId) return; // Already running
    console.log(`Starting price fetching & broadcasting every ${FETCH_INTERVAL / 1000} seconds.`);
    startDbSaving(); // Start the separate DB save interval
    // Use setTimeout chain for fetching to prevent overlapping requests if one takes too long
    fetchIntervalId = setTimeout(runFetcher, 0); // Start immediately
};

const stopFetching = async () => {
    if (fetchIntervalId) {
        clearTimeout(fetchIntervalId); // Use clearTimeout for setTimeout chain
        fetchIntervalId = null;
        console.log('Stopped price fetching & broadcasting.');
    }
    await stopDbSaving(); // Stop DB saving and perform final save
    // Close WebSocket server connections gracefully
    console.log('Closing WebSocket connections...');
    wss.clients.forEach(client => client.close());
    // server.close handles closing the HTTP server itself which also closes the WSS
    server.close(() => {
        console.log('HTTP server closed.');
    });
};

// --- Start the HTTP Server ---
server.listen(PORT, '0.0.0.0', () => { // Listen on 0.0.0.0 for Render
  console.log(`Server listening on port ${PORT}`);
  console.log(`Accepting API requests and WebSocket connections from: ${FRONTEND_URL}`);
  startFetching(); // Start the fetching process once server is listening
});

// --- Graceful Shutdown ---
process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  await stopFetching();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  await stopFetching();
  process.exit(0);
});