const logger = require('../utils/logger');

const getAllowedOrigins = () => {
  return process.env.ALLOWED_ORIGINS?.split(',') || [
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080'
  ];
};

const corsOriginHandler = (origin, callback) => {
  if (!origin) return callback(null, true);
  
  const allowedOrigins = getAllowedOrigins();
  
  if (allowedOrigins.indexOf(origin) !== -1) {
    callback(null, true);
  } else if (process.env.NODE_ENV === 'development') {
    logger.warn(`CORS: Allowing non-whitelisted origin in development: ${origin}`);
    callback(null, true);
  } else {
    logger.error(`CORS: Blocked origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  }
};

const expressCorsConfig = {
  origin: corsOriginHandler,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

const socketCorsConfig = {
  origin: corsOriginHandler,
  methods: ["GET", "POST"],
  credentials: true
};

module.exports = {
  expressCorsConfig,
  socketCorsConfig,
  getAllowedOrigins
};