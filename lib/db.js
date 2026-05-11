require('dotenv').config();
const { PrismaLibSql }  = require('@prisma/adapter-libsql');
const { PrismaClient }  = require('./generated/prisma');

function buildClient() {
  const url     = process.env.DATABASE_URL || 'file:./data/restaurant.db';
  const adapter = new PrismaLibSql({ url });
  return new PrismaClient({ adapter });
}

const db = global._prisma ?? buildClient();
if (process.env.NODE_ENV !== 'production') global._prisma = db;

module.exports = db;
