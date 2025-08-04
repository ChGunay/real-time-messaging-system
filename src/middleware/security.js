const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const logger = require('../utils/logger');


const securityConfig = {
  
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    }
  },

  
  cors: {
    origin: function (origin, callback) {
      const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
      
      
      if (!origin) return callback(null, true);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        logger.warn('CORS blocked:', { origin, allowedOrigins });
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-RateLimit-Remaining', 'X-RateLimit-Reset', 'X-RateLimit-Limit']
  },

  
  trustedProxies: process.env.TRUSTED_PROXIES?.split(',') || []
};


const securityMiddleware = [
  
  helmet(securityConfig.helmet),
  
  
  mongoSanitize({
    allowDots: true,
    replaceWith: '_'
  }),
  
  
  xss(),
  
  
  hpp({
    whitelist: ['page', 'limit', 'sort', 'fields'] 
  })
];


const validateRequest = (req, res, next) => {
  
  const suspiciousPatterns = [
    /(\$where|\$ne|\$gt|\$lt|\$gte|\$lte|\$in|\$nin|\$regex)/i, 
    /<script[^>]*>.*?<\/script>/gi, 
    /javascript:/gi, 
    /on\w+\s*=/gi, 
    /eval\s*\(/gi, 
    /function\s*\(/gi 
  ];

  const requestString = JSON.stringify(req.body) + JSON.stringify(req.query) + req.url;
  
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(requestString)) {
      logger.warn('Suspicious request detected:', {
        ip: req.ip,
        url: req.originalUrl,
        method: req.method,
        userAgent: req.get('User-Agent'),
        pattern: pattern.toString(),
        body: req.body,
        query: req.query
      });
      
      return res.status(400).json({
        success: false,
        message: 'Invalid request detected',
        code: 'SUSPICIOUS_REQUEST'
      });
    }
  }
  
  next();
};


const ipFilter = (req, res, next) => {
  const clientIP = req.ip;
  
  
  const blacklistedIPs = process.env.BLACKLISTED_IPS?.split(',') || [];
  if (blacklistedIPs.includes(clientIP)) {
    logger.warn('Blacklisted IP blocked:', { ip: clientIP });
    return res.status(403).json({
      success: false,
      message: 'Access denied',
      code: 'IP_BLOCKED'
    });
  }
  
  
  const whitelistedIPs = process.env.WHITELISTED_IPS?.split(',') || [];
  if (whitelistedIPs.length > 0 && !whitelistedIPs.includes(clientIP)) {
    logger.warn('Non-whitelisted IP blocked:', { ip: clientIP });
    return res.status(403).json({
      success: false,
      message: 'Access denied',
      code: 'IP_NOT_WHITELISTED'
    });
  }
  
  next();
};


const requestSizeLimiter = (req, res, next) => {
  const maxSize = parseInt(process.env.MAX_REQUEST_SIZE) || 10 * 1024 * 1024; 
  
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > maxSize) {
    logger.warn('Request size limit exceeded:', {
      ip: req.ip,
      size: req.headers['content-length'],
      maxSize,
      url: req.originalUrl
    });
    
    return res.status(413).json({
      success: false,
      message: 'Request entity too large',
      code: 'REQUEST_TOO_LARGE'
    });
  }
  
  next();
};


const additionalSecurityHeaders = (req, res, next) => {
  
  res.removeHeader('X-Powered-By');
  
  
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  
  next();
};


const httpsRedirect = (req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure && req.get('x-forwarded-proto') !== 'https') {
    logger.info('Redirecting HTTP to HTTPS:', { url: req.url, ip: req.ip });
    return res.redirect(301, `https://${req.get('host')}${req.url}`);
  }
  next();
};


const securityLogger = (req, res, next) => {
  const startTime = Date.now();
  
  
  logger.info('Request received:', {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    referer: req.get('Referer'),
    timestamp: new Date().toISOString()
  });
  

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger[logLevel]('Request completed:', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userId: req.user?.id
    });
  });
  
  next();
};


const bruteForceProtection = (req, res, next) => {
  
  if (!global.bruteForceAttempts) {
    global.bruteForceAttempts = new Map();
  }
  
  const key = req.ip;
  const now = Date.now();
  const attempts = global.bruteForceAttempts.get(key) || [];
  
  const validAttempts = attempts.filter(timestamp => now - timestamp < 15 * 60 * 1000);
  
  
  if (validAttempts.length >= 10) {
    logger.warn('Brute force attempt detected:', { ip: req.ip, attempts: validAttempts.length });
    return res.status(429).json({
      success: false,
      message: 'Too many failed attempts, please try again later',
      code: 'BRUTE_FORCE_DETECTED'
    });
  }
  
  
  res.on('finish', () => {
    if (req.path.includes('/login') && res.statusCode === 401) {
      validAttempts.push(now);
      global.bruteForceAttempts.set(key, validAttempts);
    }
    
    
    if (req.path.includes('/login') && res.statusCode === 200) {
      global.bruteForceAttempts.delete(key);
    }
  });
  
  next();
};


const fileUploadSecurity = {
  
  allowedMimeTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain'
  ],
  
  
  maxFileSize: 5 * 1024 * 1024,
  
  
  sanitizeFilename: (filename) => {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_') 
      .replace(/\.+/g, '.') 
      .substr(0, 100); 
  },
  
  
  validateFileType: (mimetype) => {
    return fileUploadSecurity.allowedMimeTypes.includes(mimetype);
  }
};


const socketSecurity = {
  
  validateConnection: (socket, next) => {
    const ip = socket.handshake.address;
    

    const blacklistedIPs = process.env.BLACKLISTED_IPS?.split(',') || [];
    if (blacklistedIPs.includes(ip)) {
      logger.warn('Blacklisted IP attempted socket connection:', { ip });
      return next(new Error('Connection denied'));
    }
    
    next();
  },
  
  
  eventRateLimit: new Map(),
  
  validateEventRate: (socket, eventName, maxEvents = 100, windowMs = 60000) => {
    const key = `${socket.id}:${eventName}`;
    const now = Date.now();
    const events = socketSecurity.eventRateLimit.get(key) || [];
    
      
    const validEvents = events.filter(timestamp => now - timestamp < windowMs);
    
    if (validEvents.length >= maxEvents) {
      logger.warn('Socket event rate limit exceeded:', {
        socketId: socket.id,
        eventName,
        count: validEvents.length
      });
      return false;
    }
    
    validEvents.push(now);
    socketSecurity.eventRateLimit.set(key, validEvents);
    return true;
  }
};

module.exports = {
  securityConfig,
  securityMiddleware,
  validateRequest,
  ipFilter,
  requestSizeLimiter,
  additionalSecurityHeaders,
  httpsRedirect,
  securityLogger,
  bruteForceProtection,
  fileUploadSecurity,
  socketSecurity
};