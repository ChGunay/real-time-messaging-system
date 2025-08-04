const { User } = require('../models');
const { cacheService, userOnlineService } = require('../services/redis');
const logger = require('../utils/logger');

class UserController {

  async getUserList(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = req.query.search || '';
      const skip = (page - 1) * limit;

      let query = { isActive: true };
      
      query._id = { $ne: req.user.id };

      if (search) {
        query.$or = [
          { username: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      let cacheKey = null;
      if (!search) {
        cacheKey = `user_list:page:${page}:limit:${limit}:exclude:${req.user.id}`;
        const cachedResult = await cacheService.get(cacheKey);
        
        if (cachedResult) {
          logger.debug('User list retrieved from cache');
          return res.json({
            success: true,
            data: cachedResult
          });
        }
      }

      const [users, totalUsers] = await Promise.all([
        User.find(query)
          .select('username email lastSeen createdAt')
          .sort({ username: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(query)
      ]);

      const userIds = users.map(user => user._id.toString());
      const onlineStatusMap = await userOnlineService.getUsersOnlineStatus(userIds);

      const usersWithStatus = users.map(user => ({
        id: user._id,
        username: user.username,
        email: user.email,
        lastSeen: user.lastSeen,
        createdAt: user.createdAt,
        isOnline: onlineStatusMap[user._id.toString()] || false
      }));

      const totalPages = Math.ceil(totalUsers / limit);

      const result = {
        users: usersWithStatus,
        pagination: {
          currentPage: page,
          totalPages,
          totalUsers,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      };

      if (!search && cacheKey) {
        await cacheService.set(cacheKey, result, 300); 
      }

      logger.debug(`User list retrieved: ${users.length} users, page ${page}`);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get user list error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user list'
      });
    }
  }

  async getUserById(req, res) {
    try {

      const { id } = req.params;

      //sonrasında  admin kontrolü eklemem lazım unutmaa
      if (id.toString() === req.user.id.toString()) {
        return res.redirect('/api/auth/me');
      }

      let userData = await cacheService.getCachedUser(id);

      if (!userData) {
        const user = await User.findById(id).select('username email lastSeen createdAt isActive');
        
        if (!user || !user.isActive) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        userData = {
          id: user._id,
          username: user.username,
          email: user.email,
          lastSeen: user.lastSeen,
          createdAt: user.createdAt
        };

        await cacheService.cacheUser(id, userData);
      }

      
      const isOnline = await userOnlineService.isUserOnline(id);
      userData.isOnline = isOnline;

      res.json({
        success: true,
        data: {
          user: userData
        }
      });

    } catch (error) {
      logger.error('Get user by ID error:', error);
      
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid user ID format'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Failed to get user'
      });
    }
  }

  
  async searchUsers(req, res) {
    try {
      const { q: query, limit = 10 } = req.query;

      if (!query || query.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Search query must be at least 2 characters long'
        });
      }

      const searchRegex = new RegExp(query.trim(), 'i');
      
      const users = await User.find({
        isActive: true,
        _id: { $ne: req.user.id }, 
        $or: [
          { username: searchRegex },
          { email: searchRegex }
        ]
      })
      .select('username email lastSeen')
      .limit(parseInt(limit))
      .sort({ username: 1 })
      .lean();

      
      const userIds = users.map(user => user._id.toString());
      const onlineStatusMap = await userOnlineService.getUsersOnlineStatus(userIds);

      const usersWithStatus = users.map(user => ({
        id: user._id,
        username: user.username,
        email: user.email,
        lastSeen: user.lastSeen,
        isOnline: onlineStatusMap[user._id.toString()] || false
      }));

      logger.debug(`User search completed: "${query}" returned ${users.length} results`);

      res.json({
        success: true,
        data: {
          query,
          users: usersWithStatus,
          count: users.length
        }
      });

    } catch (error) {
      logger.error('User search error:', error);
      res.status(500).json({
        success: false,
        message: 'Search failed'
      });
    }
  }

  
  async getOnlineStats(req, res) {
    try {
      const [onlineCount, onlineUsers] = await Promise.all([
        userOnlineService.getOnlineUsersCount(),
        userOnlineService.getOnlineUsers()
      ]);

      
      const sampleSize = Math.min(10, onlineUsers.length);
      const sampleUserIds = onlineUsers.slice(0, sampleSize);
      
      let sampleUsers = [];
      if (sampleUserIds.length > 0) {
        sampleUsers = await User.find({
          _id: { $in: sampleUserIds }
        })
        .select('username')
        .lean();
      }

      res.json({
        success: true,
        data: {
          onlineCount,
          totalOnlineUsers: onlineUsers.length,
          sampleOnlineUsers: sampleUsers.map(user => ({
            id: user._id,
            username: user.username
          })),
          timestamp: Date.now()
        }
      });

    } catch (error) {
      logger.error('Get online stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get online statistics'
      });
    }
  }

  
  async updateProfile(req, res) {
    try {
      const { username } = req.body;
      const userId = req.user.id;

      
      if (!username || username.trim().length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Username must be at least 3 characters long'
        });
      }

      
      const existingUser = await User.findOne({
        username: username.trim(),
        _id: { $ne: userId }
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Username is already taken'
        });
      }

      
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { 
          username: username.trim(),
          updatedAt: new Date()
        },
        { 
          new: true,
          runValidators: true
        }
      ).select('-password');

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      
      await cacheService.cacheUser(userId, {
        id: updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
        isActive: updatedUser.isActive,
        lastSeen: updatedUser.lastSeen
      });

      logger.info(`User profile updated: ${updatedUser.email}`);

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: updatedUser._id,
            username: updatedUser.username,
            email: updatedUser.email,
            isActive: updatedUser.isActive,
            lastSeen: updatedUser.lastSeen,
            updatedAt: updatedUser.updatedAt
          }
        }
      });

    } catch (error) {
      logger.error('Update profile error:', error);
      
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
        message: 'Profile update failed'
      });
    }
  }
}

module.exports = new UserController();