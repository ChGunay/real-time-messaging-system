const jwt = require('jsonwebtoken');
const logger = require('./logger');
const { cacheService } = require('../services/redis');

const memoryBlacklist = new Set();

const generateTokens = (payload) => {
  const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m'
  });

  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  });

  return { accessToken, refreshToken };
};

const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    throw new Error('Invalid access token');
  }
};

const verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch (error) {
    throw new Error('Invalid refresh token');
  }
};

const extractTokenFromHeader = (authHeader) => {
  if (!authHeader) {
    throw new Error('Authorization header is required');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new Error('Authorization header format must be: Bearer <token>');
  }

  return parts[1];
};

const blacklistToken = async (token) => {
  try {
    await cacheService.blacklistToken(token);
    logger.debug('Token blacklisted successfully');
  } catch (error) {
    logger.error('Error blacklisting token:', error);

    memoryBlacklist.add(token);
    logger.warn('Token blacklisted in memory store (Redis unavailable)');
  }
};

const isTokenBlacklisted = async (token) => {
  try {
    const isBlacklisted = await cacheService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      return true;
    }

    return memoryBlacklist.has(token);
  } catch (error) {
    logger.error('Error checking blacklisted token:', error);

    return memoryBlacklist.has(token);
  }
};

module.exports = {
  generateTokens,
  verifyAccessToken,
  verifyRefreshToken,
  extractTokenFromHeader,
  blacklistToken,
  isTokenBlacklisted
};
