const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set. Copy .env.example to .env and set your MongoDB connection string.');
  }

  mongoose.set('strictQuery', true);
  mongoose.connection.on('error', (err) => console.error('MongoDB connection error:', err.message));
  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  return mongoose.connection;
}

module.exports = connectDB;
