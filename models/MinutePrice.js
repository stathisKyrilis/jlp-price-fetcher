// models/MinutePrice.js
import mongoose from 'mongoose';

const MinutePriceSchema = new mongoose.Schema({
  jlpPrice: {
    type: Number,
    required: true,
  },
  solPrice: {
    type: Number,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
  },
});

// Create a TTL index to automatically delete documents after one year.
MinutePriceSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

const MinutePrice = mongoose.model('MinutePrice', MinutePriceSchema);

export default MinutePrice; 