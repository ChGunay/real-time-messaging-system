const elasticsearchConnection = require('../../config/elasticsearch');
const logger = require('../../utils/logger');

class MessageSearchService {
  constructor() {
    this.client = null;
    this.isEnabled = false;
  }

  async initialize() {
    this.client = elasticsearchConnection.getClient();
    this.isEnabled = elasticsearchConnection.isHealthy();

    if (!this.isEnabled) {
      logger.warn('Elasticsearch not available - search functionality disabled');
    }
  }

  async indexMessage(messageData) {
    if (!this.isEnabled || !this.client) {
      return false;
    }

    try {
      const document = {
        messageId: messageData._id.toString(),
        conversationId: messageData.conversation.toString(),
        senderId: messageData.sender._id ? messageData.sender._id.toString() : messageData.sender.toString(),
        senderUsername: messageData.sender.username || 'Unknown',
        content: messageData.content,
        messageType: messageData.messageType || 'text',
        createdAt: messageData.createdAt,
        updatedAt: messageData.updatedAt,
        isDeleted: messageData.isDeleted || false,
        metadata: {
          editedAt: messageData.metadata?.editedAt,
          editedBy: messageData.metadata?.editedBy
        }
      };

      await this.client.index({
        index: 'messages',
        id: messageData._id.toString(),
        body: document
      });

      logger.debug(`Message indexed: ${messageData._id}`);
      return true;
    } catch (error) {
      logger.error('Error indexing message:', error);
      return false;
    }
  }

  async updateMessage(messageId, updateData) {
    if (!this.isEnabled || !this.client) {
      return false;
    }

    try {
      const updateDoc = {};

      if (updateData.content) {
        updateDoc.content = updateData.content;
      }
      if (updateData.isDeleted !== undefined) {
        updateDoc.isDeleted = updateData.isDeleted;
      }
      if (updateData.metadata) {
        updateDoc.metadata = updateData.metadata;
      }

      updateDoc.updatedAt = new Date();

      await this.client.update({
        index: 'messages',
        id: messageId,
        body: {
          doc: updateDoc
        }
      });

      logger.debug(`Message updated in search index: ${messageId}`);
      return true;
    } catch (error) {
      logger.error('Error updating message in search index:', error);
      return false;
    }
  }

  async deleteMessage(messageId) {
    if (!this.isEnabled || !this.client) {
      return false;
    }

    try {
      await this.client.update({
        index: 'messages',
        id: messageId,
        body: {
          doc: {
            isDeleted: true,
            updatedAt: new Date()
          }
        }
      });

      logger.debug(`Message marked as deleted in search index: ${messageId}`);
      return true;
    } catch (error) {
      logger.error('Error deleting message from search index:', error);
      return false;
    }
  }

  async searchMessages(options) {
    if (!this.isEnabled || !this.client) {
      throw new Error('Search functionality is not available');
    }

    const {
      query,
      conversationId,
      userId,
      senderId,
      messageType,
      dateFrom,
      dateTo,
      page = 1,
      limit = 20,
      sortBy = 'relevance',
      sortOrder = 'desc'
    } = options;

    let actualSortBy = 'createdAt';
    if (sortBy === 'date') {
      actualSortBy = 'createdAt';
    } else if (sortBy === 'relevance' && !query) {
      actualSortBy = 'createdAt';
    }

    try {
      const must = [];
      const filter = [];

      if (query) {
        must.push({
          multi_match: {
            query: query,
            fields: ['content^2', 'senderUsername'],
            type: 'best_fields',
            fuzziness: 'AUTO'
          }
        });
      }

      if (conversationId) {
        filter.push({ term: { conversationId } });
      }

      if (senderId) {
        filter.push({ term: { senderId } });
      }

      if (messageType) {
        filter.push({ term: { messageType } });
      }

      filter.push({ term: { isDeleted: false } });

      if (dateFrom || dateTo) {
        const dateRange = {};
        if (dateFrom) {
          dateRange.gte = dateFrom;
        }
        if (dateTo) {
          dateRange.lte = dateTo;
        }

        filter.push({
          range: {
            createdAt: dateRange
          }
        });
      }

      if (userId) {

      }

      const searchBody = {
        query: {
          bool: {
            must: must.length > 0 ? must : [{ match_all: {} }],
            filter
          }
        },
        sort: sortBy === 'relevance' && query ? [
          { '_score': { order: 'desc' } },
          { 'createdAt': { order: 'desc' } }
        ] : [
          { [actualSortBy]: { order: sortOrder } }
        ],
        from: (page - 1) * limit,
        size: limit,
        highlight: query ? {
          fields: {
            content: {
              pre_tags: ['<mark>'],
              post_tags: ['</mark>'],
              fragment_size: 150,
              number_of_fragments: 3
            }
          }
        } : undefined
      };

      const response = await this.client.search({
        index: 'messages',
        body: searchBody
      });

      const results = response.hits.hits.map(hit => ({
        messageId: hit._source.messageId,
        conversationId: hit._source.conversationId,
        senderId: hit._source.senderId,
        senderUsername: hit._source.senderUsername,
        content: hit._source.content,
        messageType: hit._source.messageType,
        createdAt: hit._source.createdAt,
        highlights: hit.highlight?.content || [],
        score: hit._score
      }));

      const total = response.hits.total.value;
      const totalPages = Math.ceil(total / limit);

      return {
        results,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount: total,
          limit,
          hasNext: page < totalPages,
          hasPrev: page > 1
        },
        searchInfo: {
          query,
          took: response.took,
          timedOut: response.timed_out
        }
      };
    } catch (error) {
      logger.error('Search error:', error);
      throw new Error('Search operation failed');
    }
  }

  async getSuggestions(options) {
    const { prefix, conversationId, userId, limit = 5 } = options;
    return this.getMessageSuggestions(prefix, conversationId, limit);
  }

  async getMessageSuggestions(prefix, conversationId, limit = 5) {
    if (!this.isEnabled || !this.client) {
      return [];
    }

    try {
      const must = [
        {
          prefix: {
            content: prefix.toLowerCase()
          }
        }
      ];

      if (conversationId) {
        must.push({ term: { conversationId } });
      }

      const response = await this.client.search({
        index: 'messages',
        body: {
          query: {
            bool: {
              must,
              filter: [
                { term: { isDeleted: false } }
              ]
            }
          },
          _source: ['content', 'senderUsername'],
          size: limit,
          sort: [
            { createdAt: { order: 'desc' } }
          ]
        }
      });

      return response.hits.hits.map(hit => ({
        content: hit._source.content,
        senderUsername: hit._source.senderUsername
      }));
    } catch (error) {
      logger.error('Error getting message suggestions:', error);
      return [];
    }
  }

  async getStatistics(options) {
    const { period = 'month', conversationId, userId } = options;

    if (!this.isEnabled || !this.client) {
      return {
        totalMessages: 0,
        messageTypes: [],
        dailyMessages: [],
        topSenders: [],
        lastIndexed: null
      };
    }

    try {
      const now = new Date();
      let startDate;

      switch (period) {
      case 'day':
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'month':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'year':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const filter = [
        { term: { isDeleted: false } },
        {
          range: {
            createdAt: {
              gte: startDate,
              lte: now
            }
          }
        }
      ];

      if (conversationId) {
        filter.push({ term: { conversationId } });
      }

      const response = await this.client.search({
        index: 'messages',
        body: {
          query: {
            bool: { filter }
          },
          aggs: {
            message_types: {
              terms: { field: 'messageType' }
            },
            messages_over_time: {
              date_histogram: {
                field: 'createdAt',
                calendar_interval: period === 'day' ? 'hour' : 'day',
                min_doc_count: 0,
                extended_bounds: {
                  min: startDate,
                  max: now
                }
              }
            },
            top_senders: {
              terms: {
                field: 'senderUsername',
                size: 10
              }
            },
            message_count_by_hour: {
              date_histogram: {
                field: 'createdAt',
                calendar_interval: 'hour',
                min_doc_count: 0
              }
            }
          },
          size: 0
        }
      });

      const lastIndexedResponse = await this.client.search({
        index: 'messages',
        body: {
          query: {
            bool: {
              filter: [{ term: { isDeleted: false } }]
            }
          },
          sort: [{ createdAt: { order: 'desc' } }],
          size: 1,
          _source: ['createdAt']
        }
      });

      const lastIndexed = lastIndexedResponse.hits.hits.length > 0
        ? lastIndexedResponse.hits.hits[0]._source.createdAt
        : null;

      return {
        totalMessages: response.hits.total.value,
        messageTypes: response.aggregations.message_types.buckets.map(bucket => ({
          type: bucket.key,
          count: bucket.doc_count
        })),
        messagesOverTime: response.aggregations.messages_over_time.buckets.map(bucket => ({
          date: bucket.key_as_string,
          count: bucket.doc_count
        })),
        topSenders: response.aggregations.top_senders.buckets.map(bucket => ({
          username: bucket.key,
          messageCount: bucket.doc_count
        })),
        hourlyDistribution: response.aggregations.message_count_by_hour.buckets.map(bucket => ({
          hour: new Date(bucket.key).getHours(),
          count: bucket.doc_count
        })),
        lastIndexed,
        period,
        dateRange: {
          from: startDate.toISOString(),
          to: now.toISOString()
        }
      };
    } catch (error) {
      logger.error('Error getting statistics:', error);
      return {
        totalMessages: 0,
        messageTypes: [],
        messagesOverTime: [],
        topSenders: [],
        hourlyDistribution: [],
        lastIndexed: null,
        period,
        error: error.message
      };
    }
  }

  async getSearchStatistics(conversationId) {
    if (!this.isEnabled || !this.client) {
      return null;
    }

    try {
      const filter = [{ term: { isDeleted: false } }];
      if (conversationId) {
        filter.push({ term: { conversationId } });
      }

      const response = await this.client.search({
        index: 'messages',
        body: {
          query: {
            bool: { filter }
          },
          aggs: {
            message_types: {
              terms: { field: 'messageType' }
            },
            daily_messages: {
              date_histogram: {
                field: 'createdAt',
                calendar_interval: 'day',
                min_doc_count: 1
              }
            },
            top_senders: {
              terms: {
                field: 'senderUsername',
                size: 10
              }
            }
          },
          size: 0
        }
      });

      return {
        totalMessages: response.hits.total.value,
        messageTypes: response.aggregations.message_types.buckets,
        dailyMessages: response.aggregations.daily_messages.buckets,
        topSenders: response.aggregations.top_senders.buckets
      };
    } catch (error) {
      logger.error('Error getting search statistics:', error);
      return null;
    }
  }

  async reindexAllMessages() {
    if (!this.isEnabled || !this.client) {
      throw new Error('Elasticsearch not available');
    }

    try {
      await this.client.deleteByQuery({
        index: 'messages',
        body: {
          query: { match_all: {} }
        }
      });

      const Message = require('../../models/Message');

      let page = 1;
      const limit = 100;
      let totalProcessed = 0;

      while (true) {
        const messages = await Message.find({ isDeleted: false })
          .populate('sender', 'username')
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit);

        if (messages.length === 0) {
          break;
        }

        const bulk = [];
        for (const message of messages) {
          bulk.push({
            index: {
              _index: 'messages',
              _id: message._id.toString()
            }
          });

          bulk.push({
            messageId: message._id.toString(),
            conversationId: message.conversation.toString(),
            senderId: message.sender._id.toString(),
            senderUsername: message.sender.username,
            content: message.content,
            messageType: message.messageType,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
            isDeleted: message.isDeleted,
            metadata: message.metadata
          });
        }

        if (bulk.length > 0) {
          await this.client.bulk({ body: bulk });
          totalProcessed += messages.length;
          logger.info(`Reindexed ${totalProcessed} messages...`);
        }

        page++;
      }

      logger.info(`Message reindexing completed. Total: ${totalProcessed} messages`);
      return totalProcessed;
    } catch (error) {
      logger.error('Error reindexing messages:', error);
      throw error;
    }
  }
}

const messageSearchService = new MessageSearchService();

module.exports = messageSearchService;