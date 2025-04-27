    // price-fetcher/api/getPrices.js
    import mongoose from 'mongoose';
    import { ServerApiVersion } from 'mongodb';
    import Price from '../models/Price.js'; // Adjust path

    // Reuse connection logic from fetchPrice.js (or extract to a shared file)
    let conn = null;
    const MONGO_URI = process.env.MONGO_URI;

    async function connectDB() {
       if (conn == null) {
           console.log('Creating new DB connection for getPrices...');
           if (!MONGO_URI) throw new Error('MONGO_URI is not defined.');
           conn = mongoose.connect(MONGO_URI, {
               serverSelectionTimeoutMS: 5000,
               serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
           }).then(() => mongoose);
           await conn;
           console.log('DB connection established for getPrices.');
       } else {
            console.log('Reusing existing DB connection for getPrices.');
       }
       return conn;
    }

    export default async function handler(req, res) {
        try {
            await connectDB(); // Ensure DB connection

            const { limit = 1000, sort = 'desc', startDate, endDate } = req.query;

            const query = { symbol: 'JLP' };
            if (startDate || endDate) {
                query.timestamp = {};
                if (startDate) query.timestamp.$gte = new Date(startDate);
                if (endDate) query.timestamp.$lte = new Date(endDate);
            }

            const prices = await Price.find(query)
                .sort({ timestamp: sort === 'desc' ? -1 : 1 })
                .limit(parseInt(limit, 10))
                .lean(); // Use lean() for faster read-only queries

            // Ensure correct content type for JSON response
            res.setHeader('Content-Type', 'application/json');
            res.status(200).json(prices);

        } catch (err) {
            console.error("[getPrices] Error fetching prices from DB:", err);
             res.setHeader('Content-Type', 'application/json');
            res.status(500).json({ message: 'Server error retrieving price data' });
        }
    }