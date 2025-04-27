    // price-fetcher/models/Price.js
    import mongoose from 'mongoose'; // Use import

    const PriceSchema = new mongoose.Schema({
      symbol: {
        type: String,
        required: true,
        enum: ['JLP', 'SOL', 'USDC'],
        index: true
      },
      price: {
        type: Number,
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
        index: true, // Add index for faster time-based queries
      },
      tokenId: { // Store the token ID used for fetching
        type: String,
        required: true,
      }
    });

    // Explicitly create the TTL index on the 'timestamp' field
    // Expires documents 6 hours (21600 seconds) after their timestamp value
    PriceSchema.index({ timestamp: 1 }, { expireAfterSeconds: 21600 });

    // --- Compound Index for Historical Aggregation ---
    // Useful for the historical endpoint filtering by symbol and time range
    PriceSchema.index({ symbol: 1, timestamp: -1 });

    // Ensure model is not re-compiled if already exists (important for serverless)
    const Price = mongoose.models.Price || mongoose.model('Price', PriceSchema); // Use const

    export default Price; // Or module.exports if using CommonJS