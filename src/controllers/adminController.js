const jobManager = require('../jobs/jobManager');
const { AutoMessage, User, Message, Conversation } = require('../models');
const { cacheService, userOnlineService } = require('../services/redis');
const { messageProducer } = require('../services/rabbitmq');
const { elasticsearchConnection, messageSearchService } = require('../services/elasticsearch');
const logger = require('../utils/logger');
const { getMessageStats } = require('../utils/messageTemplates');

class AdminController {

  getSystemStatus = async (req, res) => {
    try {
      const [
        jobStatus,
        dbStats,
        cacheStats,
        queueStats
      ] = await Promise.all([
        jobManager.getStatus(),
        this.getDatabaseStats(),
        this.getCacheStats(),
        this.getQueueStats()
      ]);

      res.json({
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development',
          jobs: jobStatus,
          database: dbStats,
          cache: cacheStats,
          messageQueue: queueStats
        }
      });

    } catch (error) {
      logger.error('Get system status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get system status'
      });
    }
  }


  healthCheck = async (req, res) => {
    try {
      const health = await jobManager.healthCheck();
      const elasticsearchHealth = await elasticsearchConnection.healthCheck();
      
   
      health.services = health.services || {};
      health.services.elasticsearch = elasticsearchHealth;
      

      const isHealthy = health.healthy;
      const status = isHealthy ? 200 : 503;
      
      res.status(status).json({
        success: isHealthy,
        data: health
      });

    } catch (error) {
      logger.error('Health check error:', error);
      res.status(503).json({
        success: false,
        message: 'Health check failed',
        error: error.message
      });
    }
  }


  async getJobStatus(req, res) {
    try {
      const status = await jobManager.getStatus();
      
      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      logger.error('Get job status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get job status'
      });
    }
  }


  async getJobStatistics(req, res) {
    try {
      const stats = await jobManager.getJobStatistics();
      
      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      logger.error('Get job statistics error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get job statistics'
      });
    }
  }


  async triggerAutoMessagePlanner(req, res) {
    try {
      await jobManager.triggerAutoMessagePlanning();
      
      res.json({
        success: true,
        message: 'Auto message planner triggered successfully'
      });

    } catch (error) {
      logger.error('Trigger auto message planner error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to trigger auto message planner',
        error: error.message
      });
    }
  }


  async triggerQueueWorker(req, res) {
    try {
      await jobManager.triggerQueueProcessing();
      
      res.json({
        success: true,
        message: 'Queue worker triggered successfully'
      });

    } catch (error) {
      logger.error('Trigger queue worker error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to trigger queue worker',
        error: error.message
      });
    }
  }


  async controlJob(req, res) {
    try {
      const { job, action } = req.params;
      
      let result = '';
      
      switch (job) {
        case 'planner':
          if (action === 'start') {
            jobManager.startAutoMessagePlanner();
            result = 'Auto message planner started';
          } else if (action === 'stop') {
            jobManager.stopAutoMessagePlanner();
            result = 'Auto message planner stopped';
          } else {
            throw new Error('Invalid action. Use start or stop');
          }
          break;
          
        case 'worker':
          if (action === 'start') {
            jobManager.startQueueWorker();
            result = 'Queue worker started';
          } else if (action === 'stop') {
            jobManager.stopQueueWorker();
            result = 'Queue worker stopped';
          } else {
            throw new Error('Invalid action. Use start or stop');
          }
          break;
          
        case 'consumer':
          if (action === 'start') {
            await jobManager.startMessageConsumer();
            result = 'Message consumer started';
          } else if (action === 'stop') {
            await jobManager.stopMessageConsumer();
            result = 'Message consumer stopped';
          } else {
            throw new Error('Invalid action. Use start or stop');
          }
          break;
          
        default:
          throw new Error('Invalid job. Use planner, worker, or consumer');
      }
      
      res.json({
        success: true,
        message: result
      });

    } catch (error) {
      logger.error('Control job error:', error);
      res.status(400).json({
        success: false,
        message: error.message
      });
    }
  }


  async restartJobs(req, res) {
    try {
      await jobManager.restart();
      
      res.json({
        success: true,
        message: 'All jobs restarted successfully'
      });

    } catch (error) {
      logger.error('Restart jobs error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to restart jobs',
        error: error.message
      });
    }
  }


  async runMaintenance(req, res) {
    try {
      const results = await jobManager.performMaintenance();
      
      res.json({
        success: true,
        message: 'Maintenance completed successfully',
        data: results
      });

    } catch (error) {
      logger.error('Run maintenance error:', error);
      res.status(500).json({
        success: false,
        message: 'Maintenance failed',
        error: error.message
      });
    }
  }


  async getAutoMessages(req, res) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        generationRound,
        senderId,
        receiverId
      } = req.query;

      const skip = (parseInt(page) - 1) * parseInt(limit);
      

      const filter = {};
      
      if (status) {
        switch (status) {
          case 'pending':
            filter.isQueued = false;
            filter.isSent = false;
            filter.retryCount = { $lt: 3 };
            break;
          case 'queued':
            filter.isQueued = true;
            filter.isSent = false;
            break;
          case 'sent':
            filter.isSent = true;
            break;
          case 'failed':
            filter.retryCount = { $gte: 3 };
            filter.isSent = false;
            break;
        }
      }
      
      if (generationRound) {
        filter['metadata.generationRound'] = new Date(generationRound);
      }
      
      if (senderId) filter.sender = senderId;
      if (receiverId) filter.receiver = receiverId;

      const [messages, totalCount] = await Promise.all([
        AutoMessage.find(filter)
          .populate('sender', 'username email')
          .populate('receiver', 'username email')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        AutoMessage.countDocuments(filter)
      ]);

      const totalPages = Math.ceil(totalCount / parseInt(limit));

      res.json({
        success: true,
        data: {
          messages,
          pagination: {
            currentPage: parseInt(page),
            totalPages,
            totalCount,
            hasNextPage: parseInt(page) < totalPages,
            hasPrevPage: parseInt(page) > 1
          }
        }
      });

    } catch (error) {
      logger.error('Get auto messages error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get auto messages'
      });
    }
  }

    
  async getMessageTemplates(req, res) {
    try {
      const templateStats = getMessageStats();
      
      res.json({
        success: true,
        data: templateStats
      });

    } catch (error) {
      logger.error('Get message templates error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get message templates'
      });
    }
  }


  async getOnlineUsers(req, res) {
    try {
      const [onlineUsers, onlineCount] = await Promise.all([
        userOnlineService.getOnlineUsers(),
        userOnlineService.getOnlineUsersCount()
      ]);


      const sampleSize = Math.min(20, onlineUsers.length);
      const sampleUserIds = onlineUsers.slice(0, sampleSize);
      
      let userDetails = [];
      if (sampleUserIds.length > 0) {
        userDetails = await User.find({
          _id: { $in: sampleUserIds }
        }).select('username email lastSeen').lean();
      }

      res.json({
        success: true,
        data: {
          onlineCount,
          totalOnlineUsers: onlineUsers.length,
          sampleUsers: userDetails,
          allOnlineUserIds: onlineUsers
        }
      });

    } catch (error) {
      logger.error('Get online users error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get online users'
      });
    }
  }


  getDatabaseStats = async () => {
    try {
      const [userCount, conversationCount, messageCount, autoMessageCount] = await Promise.all([
        User.countDocuments(),
        Conversation.countDocuments(),
        Message.countDocuments(),
        AutoMessage.countDocuments()
      ]);

      return {
        collections: {
          users: userCount,
          conversations: conversationCount,
          messages: messageCount,
          autoMessages: autoMessageCount
        }
      };
    } catch (error) {
      logger.error('Error getting database stats:', error);
      return { error: error.message };
    }
  }

  getCacheStats = async () => {
    try {
      const stats = await cacheService.getCacheStats();
      const onlineCount = await userOnlineService.getOnlineUsersCount();
      
      return {
        redis: stats,
        onlineUsers: onlineCount
      };
    } catch (error) {
      logger.error('Error getting cache stats:', error);
      return { error: error.message };
    }
  }

  getQueueStats = async () => {
    try {
      const health = await messageProducer.healthCheck();
      return health;
    } catch (error) {
      logger.error('Error getting queue stats:', error);
      return { error: error.message };
    }
  }

  reindexMessages = async (req, res) => {
    try {
      if (!messageSearchService.isEnabled) {
        return res.status(503).json({
          success: false,
          message: 'Elasticsearch is not available'
        });
      }

      logger.info('Starting message reindexing process...');
      
      const totalProcessed = await messageSearchService.reindexAllMessages();
      
      logger.info('Message reindexing completed successfully');
      
      res.json({
        success: true,
        message: 'Message reindexing completed successfully',
        data: {
          totalProcessed,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Reindex messages error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to reindex messages',
        error: error.message
      });
    }
  }

  getSearchStats = async (req, res) => {
    try {
      if (!messageSearchService.isEnabled) {
        return res.status(503).json({
          success: false,
          message: 'Elasticsearch is not available'
        });
      }

      const stats = await messageSearchService.getSearchStatistics();
      const elasticsearchHealth = await elasticsearchConnection.healthCheck();
      
      res.json({
        success: true,
        data: {
          statistics: stats,
          elasticsearch: elasticsearchHealth,
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      logger.error('Get search stats error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get search statistics',
        error: error.message
      });
    }
  }
}

module.exports = new AdminController();