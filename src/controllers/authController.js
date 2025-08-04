const { User } = require('../models');
const { generateTokens, verifyRefreshToken, blacklistToken } = require('../utils/jwt');
const { cacheService } = require('../services/redis');
const logger = require('../utils/logger');

class AuthController {
  async register(req, res) {
    try {
      const { username, email, password } = req.body;

      const existingUser = await User.findOne({
        $or: [{ email }, { username }]
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: existingUser.email === email 
            ? 'Email already registered' 
            : 'Username already taken'
        });
      }

      const user = new User({
        username,
        email,
        password
      });

      await user.save();

      const { accessToken, refreshToken } = generateTokens({
        id: user._id,
        email: user.email,
        username: user.username
      });

      user.refreshTokens.push({
        token: refreshToken,
        createdAt: new Date()
      });
      await user.save();

      await cacheService.cacheUser(user._id.toString(), {
        id: user._id,
        username: user.username,
        email: user.email,
        isActive: user.isActive,
        lastSeen: user.lastSeen
      });

      logger.info(`New user registered: ${user.email}`);

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            isActive: user.isActive,
            createdAt: user.createdAt
          },
          tokens: {
            accessToken,
            refreshToken
          }
        }
      });

    } catch (error) {
      logger.error('Registration error:', error);
      
      if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => ({
          field: err.path,
          message: err.message
        }));
        
        return res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors
        });
      }

      res.status(500).json({
        success: false,
        message: 'Registration failed'
      });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;

      const user = await User.findOne({ email }).select('+password');

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }

      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password'
        });
      }

      user.cleanExpiredTokens();

      const { accessToken, refreshToken } = generateTokens({
        id: user._id,
        email: user.email,
        username: user.username
      });

      user.refreshTokens.push({
        token: refreshToken,
        createdAt: new Date()
      });

      user.lastSeen = new Date();
      await user.save();

      await cacheService.cacheUser(user._id.toString(), {
        id: user._id,
        username: user.username,
        email: user.email,
        isActive: user.isActive,
        lastSeen: user.lastSeen
      });

      logger.info(`User logged in: ${user.email}`);

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: {
            id: user._id,
            username: user.username,
            email: user.email,
            isActive: user.isActive,
            lastSeen: user.lastSeen
          },
          tokens: {
            accessToken,
            refreshToken
          }
        }
      });

    } catch (error) {
      logger.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed'
      });
    }
  }

  async refresh(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token is required'
        });
      }

      const decoded = verifyRefreshToken(refreshToken);

      const user = await User.findById(decoded.id);

      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      const tokenExists = user.refreshTokens.some(
        tokenObj => tokenObj.token === refreshToken
      );

      if (!tokenExists) {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      user.cleanExpiredTokens();

      const { accessToken, refreshToken: newRefreshToken } = generateTokens({
        id: user._id,
        email: user.email,
        username: user.username
      });

      user.refreshTokens = user.refreshTokens.filter(
        tokenObj => tokenObj.token !== refreshToken
      );
      user.refreshTokens.push({
        token: newRefreshToken,
        createdAt: new Date()
      });

      await user.save();

      logger.debug(`Tokens refreshed for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Tokens refreshed successfully',
        data: {
          tokens: {
            accessToken,
            refreshToken: newRefreshToken
          }
        }
      });

    } catch (error) {
      logger.error('Token refresh error:', error);
      
      if (error.message === 'Invalid refresh token') {
        return res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Token refresh failed'
      });
    }
  }

  async logout(req, res) {
    try {
      const { refreshToken } = req.body;
      const accessToken = req.token; 

      if (accessToken) {
        await blacklistToken(accessToken);
      }

      if (refreshToken && req.user) {
        const user = await User.findById(req.user.id);
        if (user) {
          user.refreshTokens = user.refreshTokens.filter(
            tokenObj => tokenObj.token !== refreshToken
          );
          await user.save();
        }
      }

      if (req.user) {
        await cacheService.invalidateUser(req.user.id);
      }

      logger.info(`User logged out: ${req.user?.email || 'unknown'}`);

      res.json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      logger.error('Logout error:', error);
      res.status(500).json({
        success: false,
        message: 'Logout failed'
      });
    }
  }

  async getProfile(req, res) {
    try {
      const userId = req.user.id;

      let userData = await cacheService.getCachedUser(userId);

      if (!userData) {
        const user = await User.findById(userId);
        
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        userData = {
          id: user._id,
          username: user.username,
          email: user.email,
          isActive: user.isActive,
          lastSeen: user.lastSeen,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt
        };

        await cacheService.cacheUser(userId, userData);
      }

      res.json({
        success: true,
        data: {
          user: userData
        }
      });

    } catch (error) {
      logger.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get profile'
      });
    }
  }

  async logoutAll(req, res) {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      user.refreshTokens = [];
      await user.save();

      if (req.token) {
        await blacklistToken(req.token);
      }

      await cacheService.invalidateUser(req.user.id);

      logger.info(`User logged out from all devices: ${user.email}`);

      res.json({
        success: true,
        message: 'Logged out from all devices successfully'
      });

    } catch (error) {
      logger.error('Logout all error:', error);
      res.status(500).json({
        success: false,
        message: 'Logout from all devices failed'
      });
    }
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;

      const user = await User.findById(req.user.id).select('+password');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const isCurrentPasswordValid = await user.comparePassword(currentPassword);
      
      if (!isCurrentPasswordValid) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect'
        });
      }

      user.password = newPassword;
      
      user.refreshTokens = [];
      
      await user.save();

      if (req.token) {
        await blacklistToken(req.token);
      }

      await cacheService.invalidateUser(req.user.id);

      logger.info(`Password changed for user: ${user.email}`);

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.'
      });

    } catch (error) {
      logger.error('Change password error:', error);
      res.status(500).json({
        success: false,
        message: 'Password change failed'
      });
    }
  }
}

module.exports = new AuthController();