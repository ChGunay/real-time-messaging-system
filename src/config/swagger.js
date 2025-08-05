const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Real-Time Messaging System API',
      version: '1.0.0',
      description: `        
        ## Özellikler
        - JWT tabanlı authentication
        - Real-time messaging (Socket.IO)
        - Otomatik mesaj sistemi
        - Redis caching & online user tracking
        - RabbitMQ message queues
        - Rate limiting & security
        - System monitoring & health checks
        
        ## Authentication
        Çoğu endpoint JWT token gerektirir. Token'ı Authorization header'ında Bearer token olarak gönderin:
        \`Authorization: Bearer YOUR_ACCESS_TOKEN\`
      `,
      contact: {
        name: 'Nodelabs Case Study',
        email: 'developer@nodelabs.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url:
          process.env.NODE_ENV === 'production'
            ? process.env.API_BASE_URL || 'https://api.example.com'
            : `http://localhost:${process.env.PORT || 3000}`,
        description:
          process.env.NODE_ENV === 'production'
            ? 'Production server'
            : 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT Authorization header using the Bearer scheme'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'User unique identifier'
            },
            username: {
              type: 'string',
              description: 'User username'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            firstName: {
              type: 'string',
              description: 'User first name'
            },
            lastName: {
              type: 'string',
              description: 'User last name'
            },
            isOnline: {
              type: 'boolean',
              description: 'User online status'
            },
            lastSeen: {
              type: 'string',
              format: 'date-time',
              description: 'Last seen timestamp'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp'
            }
          }
        },
        Conversation: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Conversation unique identifier'
            },
            participants: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/User'
              },
              description: 'Conversation participants'
            },
            lastMessage: {
              $ref: '#/components/schemas/Message'
            },
            unreadCount: {
              type: 'number',
              description: 'Unread message count for current user'
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            },
            updatedAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        Message: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Message unique identifier'
            },
            conversation: {
              type: 'string',
              description: 'Conversation ID'
            },
            sender: {
              $ref: '#/components/schemas/User'
            },
            content: {
              type: 'string',
              description: 'Message content'
            },
            messageType: {
              type: 'string',
              enum: ['text', 'auto'],
              description: 'Message type'
            },
            readBy: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user: {
                    type: 'string',
                    description: 'User ID'
                  },
                  readAt: {
                    type: 'string',
                    format: 'date-time'
                  }
                }
              }
            },
            createdAt: {
              type: 'string',
              format: 'date-time'
            }
          }
        },
        AutoMessage: {
          type: 'object',
          properties: {
            id: {
              type: 'string'
            },
            fromUser: {
              type: 'string',
              description: 'Sender user ID'
            },
            toUser: {
              type: 'string',
              description: 'Recipient user ID'
            },
            content: {
              type: 'string',
              description: 'Auto message content'
            },
            category: {
              type: 'string',
              description: 'Message category'
            },
            status: {
              type: 'string',
              enum: ['planned', 'queued', 'sent', 'failed'],
              description: 'Message status'
            },
            scheduledFor: {
              type: 'string',
              format: 'date-time',
              description: 'Scheduled delivery time'
            },
            sentAt: {
              type: 'string',
              format: 'date-time',
              description: 'Actual delivery time'
            }
          }
        },
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              description: 'Error message'
            },
            code: {
              type: 'string',
              description: 'Error code'
            },
            errors: {
              type: 'array',
              items: {
                type: 'object'
              },
              description: 'Validation errors (if any)'
            }
          }
        },
        Success: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: true
            },
            message: {
              type: 'string',
              description: 'Success message'
            },
            data: {
              type: 'object',
              description: 'Response data'
            }
          }
        },
        AuthTokens: {
          type: 'object',
          properties: {
            accessToken: {
              type: 'string',
              description: 'JWT access token (15min expiry)'
            },
            refreshToken: {
              type: 'string',
              description: 'JWT refresh token (7d expiry)'
            }
          }
        },
        PaginationMeta: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: 'Current page number'
            },
            limit: {
              type: 'number',
              description: 'Items per page'
            },
            total: {
              type: 'number',
              description: 'Total number of items'
            },
            totalPages: {
              type: 'number',
              description: 'Total number of pages'
            },
            hasNext: {
              type: 'boolean',
              description: 'Has next page'
            },
            hasPrev: {
              type: 'boolean',
              description: 'Has previous page'
            }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Authentication information is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Authentication required',
                code: 'UNAUTHORIZED'
              }
            }
          }
        },
        ValidationError: {
          description: 'Validation error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Validation failed',
                code: 'VALIDATION_ERROR',
                errors: [
                  {
                    field: 'email',
                    message: 'Email is required'
                  }
                ]
              }
            }
          }
        },
        RateLimitError: {
          description: 'Rate limit exceeded',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Too many requests, please try again later',
                code: 'RATE_LIMIT_EXCEEDED'
              }
            }
          }
        },
        InternalServerError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Internal server error',
                code: 'INTERNAL_ERROR'
              }
            }
          }
        }
      },
      parameters: {
        PageParam: {
          name: 'page',
          in: 'query',
          description: 'Page number (default: 1)',
          schema: {
            type: 'integer',
            minimum: 1,
            default: 1
          }
        },
        LimitParam: {
          name: 'limit',
          in: 'query',
          description: 'Items per page (default: 10, max: 100)',
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: 100,
            default: 10
          }
        },
        SearchParam: {
          name: 'search',
          in: 'query',
          description: 'Search query',
          schema: {
            type: 'string'
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication endpoints'
      },
      {
        name: 'Users',
        description: 'User management endpoints'
      },
      {
        name: 'Conversations',
        description: 'Conversation management endpoints'
      },
      {
        name: 'Messages',
        description: 'Message management endpoints'
      },
      {
        name: 'Admin',
        description: 'Admin and monitoring endpoints'
      },
      {
        name: 'Health',
        description: 'System health and monitoring'
      }
    ]
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js', './src/models/*.js']
};

const specs = swaggerJsdoc(options);

module.exports = {
  specs,
  swaggerUi,
  swaggerConfig: {
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #2c3e50; }
      .swagger-ui .scheme-container { background: #f8f9fa; }
    `,
    customSiteTitle: 'Real-Time Messaging API Docs',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showRequestHeaders: true,
      tryItOutEnabled: true
    }
  }
};
