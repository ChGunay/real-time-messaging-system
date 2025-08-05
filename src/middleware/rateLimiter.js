const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redisConnection = require('../config/redis');
const logger = require('../utils/logger');
const { handleRateLimitError } = require('./errorHandler');

const createRedisStore = () => {
  try {
    if (!redisConnection.client || !redisConnection.client.isReady) {
      logger.warn(
        'Redis not connected yet, using memory store for rate limiting'
      );
      return undefined;
    }

    return new RedisStore({
      sendCommand: (...args) => redisConnection.getClient().sendCommand(args),
      prefix: 'rl:'
    });
  } catch (error) {
    logger.warn(
      'Redis store for rate limiting not available, using memory store:',
      error.message
    );
    return undefined;
  }
};

const rateLimitConfigs = {
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000,
    message: {
      success: false,
      message: 'Too many requests from this IP, please try again later',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    keyGenerator: (req) => {
      return req.ip || req.connection.remoteAddress;
    },
    handler: handleRateLimitError
  },

  auth: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
      success: false,
      message: 'Too many authentication attempts, please try again later',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const email = req.body?.email;
      const ip = req.ip || req.connection.remoteAddress;
      return email ? `${ip}:${email}` : ip;
    },
    handler: handleRateLimitError
  },

  sensitive: {
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: {
      success: false,
      message: 'Too many sensitive operations, please try again later',
      code: 'SENSITIVE_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    keyGenerator: (req) => {
      const userId = req.user?.id;
      const ip = req.ip || req.connection.remoteAddress;
      return userId ? `sensitive:${userId}` : `sensitive:${ip}`;
    },
    handler: handleRateLimitError
  },

  messaging: {
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: {
      success: false,
      message: 'Too many messages sent, please slow down',
      code: 'MESSAGE_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    keyGenerator: (req) => {
      const userId = req.user?.id;
      return userId ? `messaging:${userId}` : req.ip;
    },
    handler: handleRateLimitError
  },

  api: {
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: {
      success: false,
      message: 'Too many API requests, please try again later',
      code: 'API_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    handler: handleRateLimitError
  },

  search: {
    windowMs: 1 * 60 * 1000,
    max: 20,
    message: {
      success: false,
      message: 'Too many search requests, please try again later',
      code: 'SEARCH_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    handler: handleRateLimitError
  },

  admin: {
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: {
      success: false,
      message: 'Too many admin requests, please try again later',
      code: 'ADMIN_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    keyGenerator: (req) => {
      const userId = req.user?.id;
      const ip = req.ip || req.connection.remoteAddress;
      return userId ? `admin:${userId}` : `admin:${ip}`;
    },
    handler: handleRateLimitError
  },

  upload: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: {
      success: false,
      message: 'Too many file uploads, please try again later',
      code: 'UPLOAD_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisStore(),
    keyGenerator: (req) => {
      const userId = req.user?.id;
      return userId ? `upload:${userId}` : req.ip;
    },
    handler: handleRateLimitError
  }
};

const rateLimiters = {};
Object.keys(rateLimitConfigs).forEach((key) => {
  rateLimiters[key] = rateLimit(rateLimitConfigs[key]);
});

const createCustomRateLimiter = (options) => {
  const config = {
    ...rateLimitConfigs.api,
    ...options,
    store: options.useRedis !== false ? createRedisStore() : undefined
  };

  return rateLimit(config);
};

const socketRateLimiter = {
  connections: new Map(),

  checkConnectionLimit: (socket, maxConnections = 10) => {
    const ip = socket.handshake.address;
    const connections = socketRateLimiter.connections.get(ip) || 0;

    if (connections >= maxConnections) {
      logger.warn(`Socket connection limit exceeded for IP: ${ip}`);
      socket.emit('connection_error', {
        message: 'Too many connections from this IP',
        code: 'CONNECTION_LIMIT_EXCEEDED'
      });
      socket.disconnect(true);
      return false;
    }

    socketRateLimiter.connections.set(ip, connections + 1);

    socket.on('disconnect', () => {
      const currentConnections = socketRateLimiter.connections.get(ip) || 0;
      if (currentConnections <= 1) {
        socketRateLimiter.connections.delete(ip);
      } else {
        socketRateLimiter.connections.set(ip, currentConnections - 1);
      }
    });

    return true;
  },

  messageRateLimit: new Map(),

  checkMessageRate: (userId, maxMessages = 10, windowMs = 60000) => {
    const now = Date.now();
    const userMessages = socketRateLimiter.messageRateLimit.get(userId) || [];

    const validMessages = userMessages.filter(
      (timestamp) => now - timestamp < windowMs
    );

    if (validMessages.length >= maxMessages) {
      return false;
    }

    validMessages.push(now);
    socketRateLimiter.messageRateLimit.set(userId, validMessages);

    return true;
  }
};

const rateLimitLogger = (req, res, next) => {
  const originalSend = res.send;

  res.send = function (data) {
    if (res.statusCode === 429) {
      logger.warn('Rate limit hit:', {
        ip: req.ip,
        url: req.originalUrl,
        method: req.method,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id,
        rateLimitRemaining: res.get('X-RateLimit-Remaining'),
        rateLimitReset: res.get('X-RateLimit-Reset')
      });
    }

    return originalSend.call(this, data);
  };

  next();
};

const skipRateLimit = (req, _res) => {
  if (req.path === '/health' || req.path === '/api/health') {
    return true;
  }

  const whitelistedIPs = process.env.RATE_LIMIT_WHITELIST?.split(',') || [];
  if (whitelistedIPs.includes(req.ip)) {
    return true;
  }

  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  return false;
};

Object.keys(rateLimiters).forEach((key) => {
  rateLimiters[key].skip = skipRateLimit;
});

const getRateLimitStatus = async (req, res) => {
  try {
    const ip = req.ip;
    const userId = req.user?.id;

    res.json({
      success: true,
      data: {
        ip,
        userId,
        timestamp: new Date().toISOString(),
        message: 'Rate limit status check - detailed implementation needed'
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get rate limit status'
    });
  }
};

module.exports = {
  rateLimiters,
  createCustomRateLimiter,
  socketRateLimiter,
  rateLimitLogger,
  getRateLimitStatus,
  rateLimitConfigs
};
