    // price-fetcher/models/Price.js
    import mongoose from 'mongoose'; // Use import

    const PriceSchema = new mongoose.Schema({
      symbol: {
        type: String,
        required: true,
        enum: ['JLP'], // Start with JLP, can expand later
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

    // Ensure model is not re-compiled if already exists (important for serverless)
    export default mongoose.models.Price || mongoose.model('Price', PriceSchema); // Use export default