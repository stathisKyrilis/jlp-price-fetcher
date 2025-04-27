// services/jupiterFetcher.js
import fetch from 'node-fetch'; // Use import if package.json has "type": "module", otherwise use require('node-fetch')
import mongoose from 'mongoose'; // Use import if package.json has "type": "module", otherwise use require('mongoose')
import Price from '../models/Price.js'; // Adjust path if needed

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

// --- Functions ---

// Function to fetch price and add to batch
const fetchPriceData = async () => {
  const currentApiUrl = `${API_URL_BASE}${commaSeparatedIds}`;
  const fetchedPrices = []; // Store prices fetched in this specific call

  try {
    const response = await fetch(currentApiUrl, { timeout: 5000 }); // Add timeout

    if (!response.ok) {
      const responseText = await response.text(); // Read body for debugging
      console.warn(`[${new Date().toISOString()}] API request failed! Status: ${response.status}, URL: ${currentApiUrl}, Body: ${responseText}`);
      return null; // Indicate fetch failure
    }

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
                fetchedPrices.push(priceData); // Add to current fetch results
                priceBatch.push(priceData); // Add to batch for DB saving
            } else {
                console.warn(`[${timestamp.toISOString()}] Invalid price for ${symbol} (${tokenId}):`, tokenPriceData.price);
            }
        } else {
            console.warn(`[${timestamp.toISOString()}] Price data for ${symbol} (${tokenId}) not found in API response.`);
        }
    }
    // Return only the prices fetched *this* time
    return fetchedPrices.length > 0 ? fetchedPrices : null;

  } catch (error) {
    // Handle fetch-specific errors (e.g., network issues, timeouts)
    if (error.name === 'AbortError' || error.code === 'ETIMEOUT' || error.code === 'ECONNRESET') {
        console.warn(`[${new Date().toISOString()}] Fetch timeout or network error for ${currentApiUrl}: ${error.message}`);
    } else {
        console.error(`[${new Date().toISOString()}] Error during fetch operation:`, error);
    }
    return null; // Indicate fetch failure
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
  if (saveIntervalId) return; // Already running
  console.log(`Starting DB save interval: every ${DB_SAVE_INTERVAL / 1000} seconds.`);
  saveIntervalId = setInterval(saveBatchToDB, DB_SAVE_INTERVAL);
};

const stopDbSaving = async () => {
  if (saveIntervalId) {
    clearInterval(saveIntervalId);
    saveIntervalId = null;
    console.log('Stopped DB save interval.');
    console.log('Performing final batch save on stop...');
    await saveBatchToDB(); // Attempt final save
  }
};

// Export the control functions
// Use module.exports if not using ES Modules (no "type":"module" in package.json)
export { fetchPriceData, startDbSaving, stopDbSaving };
// module.exports = { startFetching, stopFetching }; // Use this line instead if using require