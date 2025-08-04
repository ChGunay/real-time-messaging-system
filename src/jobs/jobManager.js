const AutoMessagePlanner = require('./autoMessagePlanner');
const QueueWorker = require('./queueWorker');
const { messageConsumer } = require('../services/rabbitmq');
const logger = require('../utils/logger');

class JobManager {
  constructor() {
    this.autoMessagePlanner = null;
    this.queueWorker = null;
    this.messageConsumer = messageConsumer;
    this.isInitialized = false;
  }

  
  async init() {
    try {
      logger.info('Initializing job manager...');

      
      this.autoMessagePlanner = new AutoMessagePlanner();
      this.autoMessagePlanner.init();

      
      this.queueWorker = new QueueWorker();
      this.queueWorker.init();

      
      await this.messageConsumer.startConsuming();

      this.isInitialized = true;
      logger.info('Job manager initialized successfully');

      
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('Error initializing job manager:', error);
      throw error;
    }
  }

  
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down job manager gracefully...`);
      await this.destroy();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on('SIGUSR2', shutdown); 
  }

  
  async getStatus() {
    try {
      const [
        plannerStats,
        workerStats,
        consumerStats
      ] = await Promise.all([
        this.autoMessagePlanner ? this.autoMessagePlanner.getStats() : null,
        this.queueWorker ? this.queueWorker.getDetailedStats() : null,
        this.messageConsumer ? this.messageConsumer.getConsumerStats() : null
      ]);

      return {
        isInitialized: this.isInitialized,
        timestamp: new Date().toISOString(),
        jobs: {
          autoMessagePlanner: {
            enabled: !!this.autoMessagePlanner,
            ...plannerStats
          },
          queueWorker: {
            enabled: !!this.queueWorker,
            ...workerStats
          },
          messageConsumer: {
            enabled: !!this.messageConsumer,
            ...consumerStats
          }
        }
      };
    } catch (error) {
      logger.error('Error getting job manager status:', error);
      return {
        isInitialized: this.isInitialized,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  
  async healthCheck() {
    try {
      const status = await this.getStatus();
      
      const health = {
        healthy: true,
        timestamp: new Date().toISOString(),
        services: {}
      };

      
      if (this.autoMessagePlanner) {
        const plannerHealthy = status.jobs.autoMessagePlanner.isRunning;
        health.services.autoMessagePlanner = {
          healthy: plannerHealthy,
          lastRun: status.jobs.autoMessagePlanner.lastRun,
          totalRuns: status.jobs.autoMessagePlanner.totalRuns
        };
        if (!plannerHealthy) health.healthy = false;
      }

      
      if (this.queueWorker) {
        const workerHealthy = status.jobs.queueWorker.isRunning && 
                            !status.jobs.queueWorker.lastRunStats?.error;
        health.services.queueWorker = {
          healthy: workerHealthy,
          totalRuns: status.jobs.queueWorker.totalRuns,
          errorRate: status.jobs.queueWorker.errorRate || '0%'
        };
        if (!workerHealthy) health.healthy = false;
      }


      if (this.messageConsumer) {
        const consumerHealthy = status.jobs.messageConsumer.isConsuming;
        health.services.messageConsumer = {
          healthy: consumerHealthy,
          messageCount: status.jobs.messageConsumer.stats?.messageCount || 0,
          consumerCount: status.jobs.messageConsumer.stats?.consumerCount || 0
        };
        if (!consumerHealthy) health.healthy = false;
      }

      return health;
    } catch (error) {
      logger.error('Error in job manager health check:', error);
      return {
        healthy: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  
  async triggerAutoMessagePlanning() {
    if (!this.autoMessagePlanner) {
      throw new Error('Auto message planner not initialized');
    }
    
    logger.info('Manual trigger: Auto message planning');
    await this.autoMessagePlanner.runManually();
  }

  async triggerQueueProcessing() {
    if (!this.queueWorker) {
      throw new Error('Queue worker not initialized');
    }
    
    logger.info('Manual trigger: Queue processing');
    await this.queueWorker.runManually();
  }

  
  startAutoMessagePlanner() {
    if (this.autoMessagePlanner) {
      this.autoMessagePlanner.start();
      logger.info('Auto message planner started');
    }
  }

  stopAutoMessagePlanner() {
    if (this.autoMessagePlanner) {
      this.autoMessagePlanner.stop();
      logger.info('Auto message planner stopped');
    }
  }

  startQueueWorker() {
    if (this.queueWorker) {
      this.queueWorker.start();
      logger.info('Queue worker started');
    }
  }

  stopQueueWorker() {
    if (this.queueWorker) {
      this.queueWorker.stop();
      logger.info('Queue worker stopped');
    }
  }

  async startMessageConsumer() {
    if (this.messageConsumer) {
      await this.messageConsumer.startConsuming();
      logger.info('Message consumer started');
    }
  }

  async stopMessageConsumer() {
    if (this.messageConsumer) {
      await this.messageConsumer.stopConsuming();
      logger.info('Message consumer stopped');
    }
  }

  
  async getJobStatistics() {
    try {
      const [
        pendingMessages,
        readyMessages,
        queuedMessages,
        failedMessages,
        generationRounds
      ] = await Promise.all([
        this.autoMessagePlanner ? this.autoMessagePlanner.getPendingMessagesCount() : 0,
        this.queueWorker ? this.queueWorker.getReadyMessagesCount() : 0,
        this.queueWorker ? this.queueWorker.getQueuedMessagesCount() : 0,
        this.queueWorker ? this.queueWorker.getFailedMessagesCount() : 0,
        this.autoMessagePlanner ? this.autoMessagePlanner.getGenerationRounds(5) : []
      ]);

      return {
        messageStatistics: {
          pending: pendingMessages,
          ready: readyMessages,
          queued: queuedMessages,
          failed: failedMessages,
          total: pendingMessages + readyMessages + queuedMessages + failedMessages
        },
        recentGenerationRounds: generationRounds,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      logger.error('Error getting job statistics:', error);
      return {
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  
  async performMaintenance() {
    try {
      logger.info('Starting job manager maintenance...');

      const results = {
        retriedFailedMessages: 0,
        errors: []
      };

      
      if (this.queueWorker) {
        try {
          results.retriedFailedMessages = await this.queueWorker.retryFailedMessages(50);
        } catch (error) {
          results.errors.push(`Queue worker maintenance error: ${error.message}`);
        }
      }

      logger.info('Job manager maintenance completed:', results);
      return results;

    } catch (error) {
      logger.error('Error in job manager maintenance:', error);
      throw error;
    }
  }

  
  async restart() {
    try {
      logger.info('Restarting job manager...');
      
      
      this.stopAutoMessagePlanner();
      this.stopQueueWorker();
      await this.stopMessageConsumer();
      
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      
      this.startAutoMessagePlanner();
      this.startQueueWorker();
      await this.startMessageConsumer();
      
      logger.info('Job manager restarted successfully');
      
    } catch (error) {
      logger.error('Error restarting job manager:', error);
      throw error;
    }
  }

  
  async destroy() {
    try {
      logger.info('Destroying job manager...');

      
      if (this.autoMessagePlanner) {
        this.autoMessagePlanner.destroy();
        this.autoMessagePlanner = null;
      }


      if (this.queueWorker) {
        this.queueWorker.destroy();
        this.queueWorker = null;
      }

      
      if (this.messageConsumer) {
        await this.messageConsumer.stopConsuming();
      }

      this.isInitialized = false;
      logger.info('Job manager destroyed successfully');

    } catch (error) {
      logger.error('Error destroying job manager:', error);
      throw error;
    }
  }

  
  getAutoMessagePlanner() {
    return this.autoMessagePlanner;
  }

  getQueueWorker() {
    return this.queueWorker;
  }

  getMessageConsumer() {
    return this.messageConsumer;
  }
}


const jobManager = new JobManager();

module.exports = jobManager;