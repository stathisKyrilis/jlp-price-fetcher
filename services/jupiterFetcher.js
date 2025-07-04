// services/jupiterFetcher.js
console.log('--- RUNNING LATEST VERSION OF jupiterFetcher.js ---');
import fetch from 'node-fetch'; // Use import if package.json has "type": "module", otherwise use require('node-fetch')
import mongoose from 'mongoose'; // Use import if package.json has "type": "module", otherwise use require('mongoose')
import Price from '../models/Price.js'; // Adjust path if needed
import MinutePrice from '../models/MinutePrice.js'; // <<< IMPORT NEW COMBINED MODEL

// Define the Price model directly here or require it if it's in a separate models file
const PriceSchema = new mongoose.Schema({
  symbol: {
    type: String,
    required: true,
    enum: ['JLP', 'SOL', 'USDC'],
    index: true
  },
  price: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  tokenId: { type: String, required: true }
});
const PriceModel = mongoose.models.Price || mongoose.model('Price', PriceSchema);


// --- Configuration ---
// Define all token IDs we want to fetch
const TOKEN_IDS = {
  JLP: process.env.JLP_TOKEN_ID || '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
};
// --- Log the Token IDs being used ---
console.log(`Using TOKEN_IDS:`, TOKEN_IDS);

// Construct the comma-separated string for the API query
const commaSeparatedIds = Object.values(TOKEN_IDS).join(',');
const API_URL_BASE = `https://lite-api.jup.ag/price/v2?ids=`;

const DB_SAVE_INTERVAL = parseInt(process.env.DB_SAVE_INTERVAL_MS || '5000', 10);

// --- State ---
let priceBatch = []; // Array to hold prices collected between saves
let saveIntervalId = null;
let latestJlpPrice = null; // Store the latest JLP price
let latestSolPrice = null; // Store the latest SOL price
let minuteSaveIntervalId = null; // ID for the new 1-minute interval

// --- Helper for async wait ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Functions ---

// Function to fetch price and add to batch
const fetchPriceData = async () => {
  const currentApiUrl = `${API_URL_BASE}${commaSeparatedIds}`;
  const fetchedPrices = [];
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const response = await fetch(currentApiUrl, { timeout: 5000 });

      if (response.ok) {
        // SUCCESS: Parse data and exit loop
        const data = await response.json();
        const timestamp = new Date();

        for (const symbol in TOKEN_IDS) {
            const tokenId = TOKEN_IDS[symbol];
            if (data?.data?.[tokenId]) {
                const tokenPriceData = data.data[tokenId];
                const price = Number(tokenPriceData.price);

                if (!isNaN(price)) {
                    const priceData = {
                        symbol: symbol,
                        price: price,
                        tokenId: tokenId,
                        timestamp: timestamp
                    };
                    fetchedPrices.push(priceData);

                    // Update latest prices for the 1-minute save
                    if (symbol === 'JLP') {
                        latestJlpPrice = price;
                    } else if (symbol === 'SOL') {
                        latestSolPrice = price;
                    }

                    // Only add JLP prices to the high-frequency batch
                    if (symbol === 'JLP') {
                      priceBatch.push(priceData);
                    }
                } else {
                    console.warn(`[${timestamp.toISOString()}] Invalid price for ${symbol} (${tokenId}):`, tokenPriceData.price);
                }
            } else {
                console.warn(`[${timestamp.toISOString()}] Price data for ${symbol} (${tokenId}) not found in API response.`);
            }
        }
        return fetchedPrices.length > 0 ? fetchedPrices : null; // Success, return data
      }

      // --- HANDLE RETRY-ABLE ERRORS ---
      if (response.status === 429) {
        const retryAfter = Math.pow(2, attempts) * 1000; // Exponential backoff (2s, 4s, 8s...)
        console.warn(`[${new Date().toISOString()}] Rate limit exceeded (429). Retrying in ${retryAfter / 1000}s... (Attempt ${attempts}/${maxAttempts})`);
        await sleep(retryAfter);
      } else {
        // Handle other non-ok statuses that might not be worth retrying
        const responseText = await response.text();
        console.error(`[${new Date().toISOString()}] API request failed! Status: ${response.status}, Body: ${responseText}`);
        return null; // Don't retry on other server errors like 500
      }

    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ETIMEOUT' || error.code === 'ECONNRESET') {
        const retryAfter = Math.pow(2, attempts) * 1000;
        console.warn(`[${new Date().toISOString()}] Network error/timeout. Retrying in ${retryAfter / 1000}s... (Attempt ${attempts}/${maxAttempts})`, error.message);
        await sleep(retryAfter);
      } else {
        console.error(`[${new Date().toISOString()}] Unhandled fetch error:`, error);
        return null; // Don't retry on unknown errors
      }
    }
  }

  console.error(`[${new Date().toISOString()}] Fetch failed after ${maxAttempts} attempts. Skipping this fetch cycle.`);
  return null; // Indicate fetch failure after all retries
};

// --- NEW: Function to save the latest JLP and SOL prices every minute ---
const saveMinutePrices = async () => {
    if (latestJlpPrice === null || latestSolPrice === null) {
        console.warn(`[${new Date().toISOString()}] Missing JLP or SOL price for 1-minute save.`);
        return;
    }
    if (mongoose.connection.readyState !== 1) {
        console.warn(`[${new Date().toISOString()}] DB connection not ready. Skipping 1-minute price save.`);
        return;
    }

    console.log(`[${new Date().toISOString()}] Saving minute prices: JLP=${latestJlpPrice}, SOL=${latestSolPrice}`);
    try {
        const newMinutePrice = new MinutePrice({
            jlpPrice: latestJlpPrice,
            solPrice: latestSolPrice,
        });
        await newMinutePrice.save();
        console.log(`[${new Date().toISOString()}] Successfully saved 1-minute prices.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error saving 1-minute prices to DB:`, error.message);
    }
};

// Function to save the current batch to MongoDB
const saveBatchToDB = async () => {
    if (priceBatch.length === 0) { return; }
    if (mongoose.connection.readyState !== 1) {
         console.warn(`[${new Date().toISOString()}] DB connection not ready. Skipping save cycle.`);
         // Keep batch for next attempt
         return;
    }

    const batchToSave = [...priceBatch];
    priceBatch = []; // Clear original batch *before* async operation

    console.log(`[${new Date().toISOString()}] Attempting to save batch of ${batchToSave.length} prices to DB...`);
    try {
        const result = await PriceModel.insertMany(batchToSave, { ordered: false });
        console.log(`[${new Date().toISOString()}] Successfully saved ${result.length} prices.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error saving price batch to DB:`, error.message);
        // Optional: Add failed items back to the main batch? Careful about infinite loops.
        // if (error.writeErrors) {
        //     console.error("DB Write Errors details:", error.writeErrors.map(e => e.errmsg));
        // }
    }
};

// --- Start/Stop DB Saving Interval ---
const startDbSaving = () => {
  console.log('--- DIAGNOSTIC: Entering startDbSaving() ---');
  console.log(`--- DIAGNOSTIC: Current saveIntervalId: ${saveIntervalId}`);
  // Start the 5-second batch saver if it's not already running
  if (!saveIntervalId) {
    console.log('--- DIAGNOSTIC: Condition for 5s timer is true. Setting interval. ---');
    console.log(`Starting DB save interval: every ${DB_SAVE_INTERVAL / 1000} seconds.`);
    saveIntervalId = setInterval(saveBatchToDB, DB_SAVE_INTERVAL);
  }

  console.log(`--- DIAGNOSTIC: Current minuteSaveIntervalId: ${minuteSaveIntervalId}`);
  // Start the 1-minute combined price saver if it's not already running
  if (!minuteSaveIntervalId) {
    console.log('--- DIAGNOSTIC: Condition for 1m timer is true. Setting interval. ---');
    console.log(`Starting 1-minute combined price save interval.`);
    minuteSaveIntervalId = setInterval(saveMinutePrices, 60 * 1000);
  }
  console.log('--- DIAGNOSTIC: Exiting startDbSaving() ---');
};

const stopDbSaving = async () => {
  if (saveIntervalId) {
    clearInterval(saveIntervalId);
    saveIntervalId = null;
    console.log('Stopped DB save interval.');
    console.log('Performing final batch save on stop...');
    await saveBatchToDB(); // Attempt final save
  }

  // --- Stop the new 1-minute saver ---
  if (minuteSaveIntervalId) {
    clearInterval(minuteSaveIntervalId);
    minuteSaveIntervalId = null;
    console.log('Stopped 1-minute combined price save interval.');
    await saveMinutePrices(); // Save the last captured prices on stop
  }
};

// Export the control functions
// Use module.exports if not using ES Modules (no "type":"module" in package.json)
export { fetchPriceData, startDbSaving, stopDbSaving };
// module.exports = { startFetching, stopFetching }; // Use this line instead if using require