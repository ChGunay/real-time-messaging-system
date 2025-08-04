const { verifyAccessToken, isTokenBlacklisted } = require('../../utils/jwt');
const { User } = require('../../models');
const logger = require('../../utils/logger');

const socketAuthMiddleware = async (socket, next) => {
  try {
    
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    
    if (!token) {
      return next(new Error('Authentication token is required'));
    }

    
    if (await isTokenBlacklisted(token)) {
      return next(new Error('Token has been invalidated'));
    }

    
    const decoded = verifyAccessToken(token);
    
    
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return next(new Error('User not found'));
    }

    if (!user.isActive) {
      return next(new Error('User account is deactivated'));
    }

    
    socket.userId = user._id.toString();
    socket.user = {
      id: user._id.toString(),
      username: user.username,
      email: user.email,
      isActive: user.isActive
    };

    logger.debug(`Socket authenticated for user: ${user.username} (${socket.id})`);
    next();

  } catch (error) {
    logger.error('Socket authentication error:', error);
    
    if (error.name === 'JsonWebTokenError') {
      return next(new Error('Invalid authentication token'));
    }
    
    if (error.name === 'TokenExpiredError') {
      return next(new Error('Authentication token expired'));
    }

    next(new Error('Authentication failed'));
  }
};

module.exports = socketAuthMiddleware;