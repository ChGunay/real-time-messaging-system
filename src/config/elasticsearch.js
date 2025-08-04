const { Client } = require('@elastic/elasticsearch');
const logger = require('../utils/logger');

class ElasticsearchConnection {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      this.client = new Client({
        node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
        auth: process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD ? {
          username: process.env.ELASTICSEARCH_USERNAME,
          password: process.env.ELASTICSEARCH_PASSWORD
        } : undefined,
        requestTimeout: 30000,
        pingTimeout: 3000,
        maxRetries: 3
      });

      await this.client.ping();
      
      this.isConnected = true;
      logger.info('Elasticsearch connected successfully');
      
      await this.initializeIndices();
      
      return this.client;
    } catch (error) {
      this.isConnected = false;
      logger.warn('Elasticsearch connection failed:', error.message);
      logger.warn('Message search functionality will be disabled');
      return null;
    }
  }

  async initializeIndices() {
    try {
      const indices = [
        {
          index: 'messages',
          body: {
            mappings: {
              properties: {
                messageId: { type: 'keyword' },
                conversationId: { type: 'keyword' },
                senderId: { type: 'keyword' },
                senderUsername: { type: 'keyword' },
                content: { 
                  type: 'text',
                  analyzer: 'standard',
                  search_analyzer: 'standard'
                },
                messageType: { type: 'keyword' },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
                isDeleted: { type: 'boolean' },
                metadata: {
                  properties: {
                    editedAt: { type: 'date' },
                    editedBy: { type: 'keyword' }
                  }
                }
              }
            },
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              analysis: {
                analyzer: {
                  custom_text_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'stop']
                  }
                }
              }
            }
          }
        },
        {
          index: 'users',
          body: {
            mappings: {
              properties: {
                userId: { type: 'keyword' },
                username: { 
                  type: 'text',
                  fields: {
                    keyword: { type: 'keyword' }
                  }
                },
                email: { type: 'keyword' },
                isActive: { type: 'boolean' },
                createdAt: { type: 'date' },
                lastSeen: { type: 'date' }
              }
            }
          }
        }
      ];

      for (const { index, body } of indices) {
        const exists = await this.client.indices.exists({ index });
        if (!exists) {
          await this.client.indices.create({ index, body });
          logger.info(`Elasticsearch index '${index}' created`);
        }
      }
    } catch (error) {
      logger.error('Error initializing Elasticsearch indices:', error);
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.close();
        this.isConnected = false;
        logger.info('Elasticsearch disconnected');
      } catch (error) {
        logger.error('Error disconnecting from Elasticsearch:', error);
      }
    }
  }

  getClient() {
    return this.client;
  }

  isHealthy() {
    return this.isConnected && this.client;
  }

  async healthCheck() {
    try {
      if (!this.client) return { healthy: false, error: 'Client not initialized' };
      
      const health = await this.client.cluster.health();
      return {
        healthy: health.status !== 'red',
        status: health.status,
        numberOfNodes: health.number_of_nodes,
        numberOfDataNodes: health.number_of_data_nodes
      };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }
}

const elasticsearchConnection = new ElasticsearchConnection();

module.exports = elasticsearchConnection;