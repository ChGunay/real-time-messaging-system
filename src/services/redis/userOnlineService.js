const redisConnection = require('../../config/redis');
const logger = require('../../utils/logger');

class UserOnlineService {
  constructor() {
    this.ONLINE_USERS_KEY = 'online_users';
    this.USER_SOCKET_PREFIX = 'user_socket:';
    this.USER_STATUS_PREFIX = 'user_status:';
  }

  getClient() {
    return redisConnection.getClient();
  }

  getPublisher() {
    return redisConnection.getPublisher();
  }

  async setUserOnline(userId, socketId = null) {
    try {
      const client = this.getClient();
      const publisher = this.getPublisher();

      await client.sAdd(this.ONLINE_USERS_KEY, userId);

      if (socketId) {
        await client.set(`${this.USER_SOCKET_PREFIX}${userId}`, socketId, {
          EX: 3600 // 1 hour expiration
        });
      }

      await client.hSet(`${this.USER_STATUS_PREFIX}${userId}`, {
        status: 'online',
        lastSeen: Date.now(),
        connectedAt: Date.now()
      });

      await publisher.publish('user_status_change', JSON.stringify({
        userId,
        status: 'online',
        timestamp: Date.now()
      }));

      logger.debug(`User ${userId} set as online`);
      return true;
    } catch (error) {
      logger.error('Error setting user online:', error);
      throw error;
    }
  }

  async setUserOffline(userId) {
    try {
      const client = this.getClient();
      const publisher = this.getPublisher();

      await client.sRem(this.ONLINE_USERS_KEY, userId);

      await client.del(`${this.USER_SOCKET_PREFIX}${userId}`);

      await client.hSet(`${this.USER_STATUS_PREFIX}${userId}`, {
        status: 'offline',
        lastSeen: Date.now()
      });

      await publisher.publish('user_status_change', JSON.stringify({
        userId,
        status: 'offline',
        timestamp: Date.now()
      }));

      logger.debug(`User ${userId} set as offline`);
      return true;
    } catch (error) {
      logger.error('Error setting user offline:', error);
      throw error;
    }
  }

  async isUserOnline(userId) {
    try {
      const client = this.getClient();
      const isOnline = await client.sIsMember(this.ONLINE_USERS_KEY, userId);
      return isOnline;
    } catch (error) {
      logger.error('Error checking user online status:', error);
      return false;
    }
  }

  async getOnlineUsers() {
    try {
      const client = this.getClient();
      const onlineUsers = await client.sMembers(this.ONLINE_USERS_KEY);
      return onlineUsers;
    } catch (error) {
      logger.error('Error getting online users:', error);
      return [];
    }
  }

  async getOnlineUsersCount() {
    try {
      const client = this.getClient();
      const count = await client.sCard(this.ONLINE_USERS_KEY);
      return count;
    } catch (error) {
      logger.error('Error getting online users count:', error);
      return 0;
    }
  }

  async getUserSocketId(userId) {
    try {
      const client = this.getClient();
      const socketId = await client.get(`${this.USER_SOCKET_PREFIX}${userId}`);
      return socketId;
    } catch (error) {
      logger.error('Error getting user socket ID:', error);
      return null;
    }
  }

  async getUserStatus(userId) {
    try {
      const client = this.getClient();
      const status = await client.hGetAll(`${this.USER_STATUS_PREFIX}${userId}`);

      if (!status || Object.keys(status).length === 0) {
        return {
          status: 'offline',
          lastSeen: null,
          connectedAt: null
        };
      }

      return {
        status: status.status || 'offline',
        lastSeen: status.lastSeen ? parseInt(status.lastSeen) : null,
        connectedAt: status.connectedAt ? parseInt(status.connectedAt) : null
      };
    } catch (error) {
      logger.error('Error getting user status:', error);
      return {
        status: 'offline',
        lastSeen: null,
        connectedAt: null
      };
    }
  }

  async getUsersOnlineStatus(userIds) {
    try {
      const client = this.getClient();
      const pipeline = client.multi();

      userIds.forEach(userId => {
        pipeline.sIsMember(this.ONLINE_USERS_KEY, userId);
      });

      const results = await pipeline.exec();

      const statusMap = {};
      userIds.forEach((userId, index) => {
        statusMap[userId] = results[index] || false;
      });

      return statusMap;
    } catch (error) {
      logger.error('Error getting users online status:', error);
      return {};
    }
  }

  async updateLastSeen(userId) {
    try {
      const client = this.getClient();
      await client.hSet(`${this.USER_STATUS_PREFIX}${userId}`, 'lastSeen', Date.now());
    } catch (error) {
      logger.error('Error updating last seen:', error);
    }
  }

  async cleanupExpiredData() {
    try {
      const client = this.getClient();
      const onlineUsers = await this.getOnlineUsers();

      for (const userId of onlineUsers) {
        const socketId = await this.getUserSocketId(userId);
        if (!socketId) {

          await this.setUserOffline(userId);
        }
      }

      logger.debug('Cleanup expired user data completed');
    } catch (error) {
      logger.error('Error cleaning up expired data:', error);
    }
  }

  async subscribeToStatusChanges(callback) {
    try {
      const subscriber = redisConnection.getSubscriber();

      await subscriber.subscribe('user_status_change', (message) => {
        try {
          const data = JSON.parse(message);
          callback(data);
        } catch (error) {
          logger.error('Error parsing status change message:', error);
        }
      });

      logger.info('Subscribed to user status changes');
    } catch (error) {
      logger.error('Error subscribing to status changes:', error);
      throw error;
    }
  }
}

module.exports = new UserOnlineService();