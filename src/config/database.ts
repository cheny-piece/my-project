import { PrismaClient } from '@prisma/client';
import Redis from 'redis';

export const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],
});

export const redis = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redis.on('error', (err) => {
  console.error('Redis Client Error', err);
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export const connectDatabases = async () => {
  try {
    await prisma.$connect();
    await redis.connect();
    console.log('Databases connected successfully');
  } catch (error) {
    console.error('Database connection failed:', error);
    process.exit(1);
  }
};

export const disconnectDatabases = async () => {
  await prisma.$disconnect();
  await redis.disconnect();
};