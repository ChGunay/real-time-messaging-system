const logger = require('../utils/logger');

class AppError extends Error {
  constructor(message, statusCode, code = null, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}`;
  return new AppError(message, 400, 'INVALID_ID');
};

const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  const message = `${field.charAt(0).toUpperCase() + field.slice(1)} '${value}' already exists`;
  return new AppError(message, 409, 'DUPLICATE_FIELD', { field, value });
};

const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map((el) => ({
    field: el.path,
    message: el.message,
    value: el.value
  }));

  const message = 'Invalid input data';
  return new AppError(message, 400, 'VALIDATION_ERROR', { errors });
};

const handleJWTError = () => {
  return new AppError(
    'Invalid token. Please log in again',
    401,
    'INVALID_TOKEN'
  );
};

const handleJWTExpiredError = () => {
  return new AppError(
    'Your token has expired. Please log in again',
    401,
    'EXPIRED_TOKEN'
  );
};

const handleRedisError = (err) => {
  logger.error('Redis error:', err);
  return new AppError(
    'Cache service temporarily unavailable',
    503,
    'CACHE_ERROR'
  );
};

const handleRabbitMQError = (err) => {
  logger.error('RabbitMQ error:', err);
  return new AppError(
    'Message queue service temporarily unavailable',
    503,
    'QUEUE_ERROR'
  );
};

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    success: false,
    error: {
      status: err.status,
      message: err.message,
      code: err.code,
      details: err.details,
      stack: err.stack
    }
  });
};

const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      code: err.code,
      ...(err.details && { details: err.details })
    });
  } else {
    logger.error('Programming Error:', err);

    res.status(500).json({
      success: false,
      message: 'Something went wrong!',
      code: 'INTERNAL_ERROR'
    });
  }
};

const globalErrorHandler = (err, req, res, _next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    if (error.name === 'CastError') {
      error = handleCastErrorDB(error);
    }
    if (error.code === 11000) {
      error = handleDuplicateFieldsDB(error);
    }
    if (error.name === 'ValidationError') {
      error = handleValidationErrorDB(error);
    }
    if (error.name === 'JsonWebTokenError') {
      error = handleJWTError();
    }
    if (error.name === 'TokenExpiredError') {
      error = handleJWTExpiredError();
    }
    if (error.name === 'RedisError') {
      error = handleRedisError(error);
    }
    if (error.name === 'AMQPConnectionError') {
      error = handleRabbitMQError(error);
    }

    sendErrorProd(error, res);
  }

  logger.error('Error handled:', {
    message: err.message,
    statusCode: err.statusCode,
    code: err.code,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id
  });
};

process.on('unhandledRejection', (err, _promise) => {
  logger.error('Unhandled Promise Rejection:', err);

  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);

  process.exit(1);
});

const handleUndefinedRoutes = (req, res, next) => {
  const err = new AppError(
    `Can't find ${req.originalUrl} on this server!`,
    404,
    'ROUTE_NOT_FOUND'
  );
  next(err);
};

const handleRequestTimeout = (timeout = 30000) => {
  return (req, res, next) => {
    req.setTimeout(timeout, () => {
      const err = new AppError('Request timeout', 408, 'REQUEST_TIMEOUT');
      next(err);
    });
    next();
  };
};

const handleDBConnectionError = (err) => {
  logger.error('Database connection error:', err);
  return new AppError(
    'Database service temporarily unavailable',
    503,
    'DB_CONNECTION_ERROR'
  );
};

const handleFileUploadError = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return new AppError('File too large', 413, 'FILE_TOO_LARGE');
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return new AppError('Too many files', 413, 'TOO_MANY_FILES');
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return new AppError('Unexpected file field', 400, 'UNEXPECTED_FILE');
  }
  return new AppError('File upload error', 400, 'FILE_UPLOAD_ERROR');
};

const handleRateLimitError = (req, res) => {
  const err = new AppError(
    'Too many requests from this IP, please try again later',
    429,
    'RATE_LIMIT_EXCEEDED'
  );

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else {
    sendErrorProd(err, res);
  }
};

const handleSocketError = (socket, err) => {
  logger.error('Socket error:', {
    error: err.message,
    stack: err.stack,
    socketId: socket.id,
    userId: socket.userId
  });

  socket.emit('error', {
    message: 'An error occurred',
    code: 'SOCKET_ERROR'
  });
};

const formatValidationErrors = (errors) => {
  return errors.map((error) => ({
    field: error.path?.join('.') || error.field,
    message: error.message,
    value: error.value
  }));
};

module.exports = {
  AppError,
  catchAsync,
  globalErrorHandler,
  handleUndefinedRoutes,
  handleRequestTimeout,
  handleDBConnectionError,
  handleFileUploadError,
  handleRateLimitError,
  handleSocketError,
  formatValidationErrors,
  handleCastErrorDB,
  handleDuplicateFieldsDB,
  handleValidationErrorDB,
  handleJWTError,
  handleJWTExpiredError,
  handleRedisError,
  handleRabbitMQError
};
