// api/config/db.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config(); // Load .env variables

const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    console.log('MongoDB already connected.');
    return;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      // useNewUrlParser: true, // Deprecated but sometimes needed for older versions
      // useUnifiedTopology: true, // Deprecated
      serverSelectionTimeoutMS: 5000 // Timeout after 5s instead of 30s
    });
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error('MongoDB Connection Error:', err.message);
    // Exit process with failure after attempting connection
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected!');
    // Optionally attempt to reconnect here or handle accordingly
  });

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection error after initial connection:', err.message);
  });
};

export default connectDB;