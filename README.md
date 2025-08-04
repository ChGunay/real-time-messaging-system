# Real-Time Messaging System

Production-ready real-time messaging system developed for Nodelabs Backend Developer Case Study.

## 🚀 Quick Start

### Prerequisites
- Node.js (v16+)
- MongoDB (v5.0+)
- Redis (v6.0+)
- RabbitMQ (v3.8+)

### Installation & Setup

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd real-time-messaging-system
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   # ⚠️ IMPORTANT: Use secure JWT secrets in production!
   ```

3. **Start required services**
   ```bash
   # macOS with Homebrew
   brew services start mongodb-community
   brew services start redis
   brew services start rabbitmq
   
   # Or manually
   mongod
   redis-server
   rabbitmq-server
   ```

4. **Start the application**
   ```bash
   npm run dev    # Development
   npm start      # Production
   ```

## 📖 API Documentation

- **Swagger UI**: http://localhost:3000/api-docs
- **Health Check**: http://localhost:3000/health

## 🎯 Core Features

### ✅ Authentication System
- JWT-based authentication with refresh tokens
- Password hashing and security
- Multi-device logout support

### ✅ Real-Time Messaging
- Socket.IO implementation with JWT auth
- Live typing indicators and read receipts
- Online presence tracking

### ✅ Auto Message System
- 3-stage pipeline: Planning → Queuing → Delivery
- Cron-based scheduling (02:00 daily)
- RabbitMQ message queues

### ✅ Admin & Monitoring
- System health monitoring
- Job management and control
- Real-time metrics and statistics

### ✅ Security & Performance
- Multi-tier rate limiting with Redis
- Input sanitization and validation
- Comprehensive error handling
- Security headers and CORS protection

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │◄──►│   Socket.IO     │◄──►│   REST API      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                               ▲                        ▲
                               │                        │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Auto Message  │◄──►│   Job Manager   │◄──►│   Auth System   │
│   System        │    │   Cron Workers  │    │   JWT + Redis   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        ▲                        ▲                        ▲
        │                        │                        │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   RabbitMQ      │◄──►│   Redis Cache   │◄──►│   MongoDB       │
│   Message Queue │    │   Online Users  │    │   Data Storage  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📊 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/refresh` - Token refresh
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get profile

### Users
- `GET /api/user/list` - User list with pagination
- `GET /api/user/search` - Search users
- `GET /api/user/online/stats` - Online statistics

### Conversations & Messages
- `GET /api/conversations` - User conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/{id}/messages` - Get messages
- `POST /api/conversations/{id}/messages` - Send message

### Admin
- `GET /api/admin/status` - System status
- `GET /api/admin/health` - Health check
- `GET /api/admin/jobs/status` - Job status
- `POST /api/admin/jobs/control/{job}/{action}` - Control jobs

## 🔒 Security Features

- **JWT Authentication** with access & refresh tokens
- **Rate Limiting** across multiple tiers
- **Input Validation** and sanitization
- **Security Headers** (Helmet.js)
- **CORS Protection** with environment-based origins
- **NoSQL Injection** prevention
- **XSS Protection** and parameter pollution prevention

## ⚙️ Environment Configuration

Key environment variables (see `.env.example`):

```bash
# Required
NODE_ENV=production|development
JWT_ACCESS_SECRET=your_secure_secret
JWT_REFRESH_SECRET=your_secure_secret
MONGODB_URI=mongodb://localhost:27017/messaging_system

# Optional
PORT=3000
REDIS_HOST=localhost
RABBITMQ_URL=amqp://localhost:5672
API_BASE_URL=https://api.yourdomain.com
```

## 📈 Monitoring & Health

- **Health Endpoints**: `/health`, `/health/detailed`
- **Metrics**: `/metrics`
- **System Monitoring**: Real-time performance tracking
- **Error Logging**: Winston-based comprehensive logging

## 🛠️ Development

```bash
npm run dev     # Development with nodemon
npm test        # Run tests
npm run lint    # ESLint
npm run format  # Prettier
```

## 🚢 Production Deployment

1. **Environment Setup**
   - Set `NODE_ENV=production`
   - Configure secure JWT secrets
   - Set appropriate `LOG_LEVEL`
   - Configure production URLs

2. **Database Setup**
   - Ensure MongoDB indexes are created
   - Configure Redis persistence
   - Set up RabbitMQ clustering if needed

3. **Security**
   - Configure CORS origins for production
   - Set up SSL/TLS termination
   - Configure rate limiting appropriately
   - Set up monitoring and alerting

## 📁 Project Structure

```
src/
├── config/           # Database, Redis, RabbitMQ, CORS
├── controllers/      # Request handlers
├── middleware/       # Auth, validation, security, rate limiting
├── models/           # MongoDB schemas
├── routes/           # API endpoints
├── services/         # Business logic (Redis, RabbitMQ, Socket.IO)
├── jobs/             # Background jobs and cron workers
├── utils/            # Utilities (JWT, logger, monitoring)
└── app.js            # Main application
```

## 🤝 Contributing

1. Follow existing code style and patterns
2. Write comprehensive tests
3. Update documentation
4. Follow security best practices

## 📄 License

MIT License

---

**Production Ready** ✅ | **Fully Documented** ✅ | **Security Hardened** ✅