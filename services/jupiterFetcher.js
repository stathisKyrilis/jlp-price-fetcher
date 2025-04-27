// services/jupiterFetcher.js
import fetch from 'node-fetch'; // Use import if package.json has "type": "module", otherwise use require('node-fetch')
import mongoose from 'mongoose'; // Use import if package.json has "type": "module", otherwise use require('mongoose')

// Define the Price model directly here or require it if it's in a separate models file
const PriceSchema = new mongoose.Schema({
  symbol: { type: String, required: true, enum: ['JLP'] },
  price: { type: Number, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  tokenId: { type: String, required: true }
});
const Price = mongoose.models.Price || mongoose.model('Price', PriceSchema);


// --- Configuration ---
const JLP_TOKEN_ID = process.env.JLP_TOKEN_ID || '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4';
const API_URL = `https://price.jup.ag/v4/price?ids=${JLP_TOKEN_ID}`; // Use v4 endpoint - check Jupiter docs if needed
const FAST_FETCH_INTERVAL = parseInt(process.env.FAST_FETCH_INTERVAL_MS || '1000', 10); // Default 1 second
const DB_SAVE_INTERVAL = parseInt(process.env.DB_SAVE_INTERVAL_MS || '10000', 10); // Default 10 seconds

// --- State ---
let priceBatch = []; // Array to hold prices collected between saves
let fetchIntervalId = null;
let saveIntervalId = null;

// --- Functions ---

// Function to fetch price and add to batch
const fetchAndBatchPrice = async () => {
  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
       console.warn(`[${new Date().toISOString()}] API request failed with status ${response.status}`);
       return;
    }
    const data = await response.json();
    const timestamp = new Date(); // Capture timestamp when fetched

    if (data?.data?.[JLP_TOKEN_ID]) {
      const jlpPriceData = data.data[JLP_TOKEN_ID];
      // V4 API structure might differ slightly, adjust if needed
      // Example: Assume price is directly available
      const price = Number(jlpPriceData.price);

      if (!isNaN(price)) {
        priceBatch.push({
          symbol: 'JLP',
          price: price,
          tokenId: JLP_TOKEN_ID,
          timestamp: timestamp
        });
      } else {
        console.warn(`[${timestamp.toISOString()}] Invalid price number received for JLP:`, jlpPriceData.price);
      }
    } else {
      console.warn(`[${new Date().toISOString()}] JLP price data structure not found as expected in API response.`);
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error fetching JLP price:`, error.message);
  }
};

// Function to save the current batch to MongoDB
const saveBatchToDB = async () => {
    if (priceBatch.length === 0) {
        return; // Nothing to save
    }

    const batchToSave = [...priceBatch];
    priceBatch = []; // Clear the batch immediately

    console.log(`[${new Date().toISOString()}] Attempting to save batch of ${batchToSave.length} prices to DB...`);

    try {
        // Ensure DB connection is ready before inserting
        if (mongoose.connection.readyState !== 1) {
             console.warn(`[${new Date().toISOString()}] DB connection not ready. Skipping save cycle.`);
             // Optionally put batch back if needed, but might lead to memory issues
             // priceBatch = [...batchToSave, ...priceBatch];
             return;
        }
        const result = await Price.insertMany(batchToSave, { ordered: false });
        console.log(`[${new Date().toISOString()}] Successfully saved ${result.length} prices.`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error saving price batch to DB:`, error.message);
        if (error.writeErrors) {
             console.error("DB Write Errors details:", error.writeErrors.map(e => e.errmsg));
        }
        // Decide on error handling: retry, log failed data, etc.
    }
};

// --- Control ---

const startFetching = () => {
  if (fetchIntervalId || saveIntervalId) {
    console.log('Fetcher already running.');
    return;
  }
  console.log(`Starting JLP price fetching every ${FAST_FETCH_INTERVAL / 1000} seconds.`);
  console.log(`Starting DB save every ${DB_SAVE_INTERVAL / 1000} seconds.`);

  fetchIntervalId = setInterval(fetchAndBatchPrice, FAST_FETCH_INTERVAL);
  saveIntervalId = setInterval(saveBatchToDB, DB_SAVE_INTERVAL);

  // Fetch immediately first time?
  fetchAndBatchPrice();
};

const stopFetching = () => {
  if (fetchIntervalId) {
    clearInterval(fetchIntervalId);
    fetchIntervalId = null;
    console.log('Stopped JLP price fetching interval.');
  }
   if (saveIntervalId) {
    clearInterval(saveIntervalId);
    saveIntervalId = null;
    console.log('Stopped DB save interval.');
    // Attempt to save any remaining items in the batch
    console.log('Performing final batch save on stop...');
    saveBatchToDB(); // Might need await if called before process exit
  }
};

// Export the control functions
// Use module.exports if not using ES Modules (no "type":"module" in package.json)
export { startFetching, stopFetching };
// module.exports = { startFetching, stopFetching }; // Use this line instead if using require