    // price-fetcher/api/fetchPrice.js
    import fetch from 'node-fetch'; // Use import syntax for Vercel functions
    import mongoose from 'mongoose';
    import { ServerApiVersion } from 'mongodb';
    import Price from '../models/Price.js'; // Adjust path and use .js extension

    // Centralized connection function (improves connection reuse across invocations)
    let conn = null;
    const MONGO_URI = process.env.MONGO_URI;
    const JLP_TOKEN_ID = process.env.JLP_TOKEN_ID || '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4';
    const API_URL = `https://api.jup.ag/price/v2?ids=${JLP_TOKEN_ID}`;


    async function connectDB() {
        if (conn == null) {
            console.log('Creating new DB connection...');
            if (!MONGO_URI) {
                throw new Error('MONGO_URI is not Defined in environment variables.');
            }
            conn = mongoose.connect(MONGO_URI, {
                serverSelectionTimeoutMS: 5000, // Shorten timeout for serverless
                serverApi: {
                    version: ServerApiVersion.v1,
                    strict: true,
                    deprecationErrors: true,
                }
            }).then(() => mongoose);

            // `await` the promise to ensure the connection is ready
            await conn;
            console.log('DB connection established.');
        } else {
            console.log('Reusing existing DB connection.');
        }
        return conn;
    }

    // The main serverless function handler
    export default async function handler(req, res) {
        // --- Security Check ---
        const expectedAuth = `Bearer ${process.env.CRON_SECRET}`;
        const receivedAuth = req.headers['authorization'];

        if (!process.env.CRON_SECRET || !receivedAuth || receivedAuth !== expectedAuth) {
             console.warn('Unauthorized cron trigger attempt.');
             return res.status(401).json({ message: 'Unauthorized' });
        }
        // --- End Security Check ---

        console.log(`[${new Date().toISOString()}] Cron job fetchPrice started (authorized).`);

        try {
            await connectDB(); // Ensure DB connection

            const response = await fetch(API_URL);
            if (!response.ok) {
                // Log specific error but don't necessarily crash the function
                 console.warn(`[${new Date().toISOString()}] API request failed with status ${response.status}: ${await response.text()}`);
                 // Respond with an error status but don't throw, allow cron to continue next time
                 return res.status(502).json({ message: `API request failed: ${response.status}` });
            }
            const data = await response.json();

            let savedPrice = null;
            if (data?.data?.[JLP_TOKEN_ID]) {
                 const jlpPriceData = data.data[JLP_TOKEN_ID];
                 const price = Number(jlpPriceData.price);
                 const timestamp = new Date();

                if (!isNaN(price)) {
                    const newPriceEntry = new Price({
                        symbol: 'JLP',
                        price: price,
                        tokenId: JLP_TOKEN_ID,
                        timestamp: timestamp
                    });
                    savedPrice = await newPriceEntry.save();
                    console.log(`[${timestamp.toISOString()}] Stored JLP price: ${price}`);
                } else {
                    console.warn(`[${timestamp.toISOString()}] Invalid price received for JLP:`, jlpPriceData.price);
                }
            } else {
                console.warn(`[${new Date().toISOString()}] JLP price data not found in API response.`);
            }

            // Respond successfully
            res.status(200).json({
                message: 'Price fetched successfully.',
                savedPrice: savedPrice ? { price: savedPrice.price, timestamp: savedPrice.timestamp } : null
            });

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in fetchPrice handler:`, error);
            res.status(500).json({ message: 'Error fetching or storing price.', error: error.message });
        }
    }