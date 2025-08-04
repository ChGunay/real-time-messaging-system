const logger = require('./logger');

class SystemMonitor {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        errors: 0,
        byMethod: {},
        byRoute: {},
        responseTime: []
      },
      memory: {
        usage: [],
        maxUsage: 0
      },
      cpu: {
        usage: []
      },
      database: {
        connections: 0,
        queries: 0,
        errors: 0
      },
      redis: {
        connections: 0,
        operations: 0,
        errors: 0
      },
      rabbitmq: {
        messages: {
          sent: 0,
          received: 0,
          failed: 0
        }
      },
      sockets: {
        connected: 0,
        events: 0,
        errors: 0
      }
    };
    
    this.alerts = [];
    this.thresholds = {
      memory: 80, 
      cpu: 80, 
      responseTime: 5000, 
      errorRate: 10 
    };
    
    this.isMonitoring = false;
    this.monitoringInterval = null;
  }

  
  start(intervalMs = 30000) {
    if (this.isMonitoring) {
      logger.warn('System monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting system monitoring...');

    
    this.monitoringInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.checkThresholds();
      this.cleanupOldMetrics();
    }, intervalMs);

    
    this.collectSystemMetrics();
  }

  
  stop() {
    if (!this.isMonitoring) {
      logger.warn('System monitoring is not running');
      return;
    }

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    this.isMonitoring = false;
    logger.info('System monitoring stopped');
  }

  
  collectSystemMetrics() {
    try {
      
      const memUsage = process.memoryUsage();
      const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      this.metrics.memory.usage.push({
        timestamp: Date.now(),
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        percentage: memPercent
      });

      if (memPercent > this.metrics.memory.maxUsage) {
        this.metrics.memory.maxUsage = memPercent;
      }

      
      const cpuUsage = process.cpuUsage();
      this.metrics.cpu.usage.push({
        timestamp: Date.now(),
        user: cpuUsage.user,
        system: cpuUsage.system
      });

      logger.debug('System metrics collected:', {
        memory: `${memPercent.toFixed(2)}%`,
        uptime: `${process.uptime()}s`
      });

    } catch (error) {
      logger.error('Error collecting system metrics:', error);
    }
  }

  
  trackRequest(req, res, responseTime) {
    this.metrics.requests.total++;
    
    
    const method = req.method;
    this.metrics.requests.byMethod[method] = (this.metrics.requests.byMethod[method] || 0) + 1;
    
    
    const route = req.route?.path || req.path;
    this.metrics.requests.byRoute[route] = (this.metrics.requests.byRoute[route] || 0) + 1;
    

    this.metrics.requests.responseTime.push({
      timestamp: Date.now(),
      duration: responseTime,
      method,
      route,
      statusCode: res.statusCode
    });
    
    
    if (res.statusCode >= 200 && res.statusCode < 400) {
      this.metrics.requests.success++;
    } else {
      this.metrics.requests.errors++;
    }
  }

  
  trackDatabase(operation, success = true) {
    this.metrics.database.queries++;
    
    if (!success) {
      this.metrics.database.errors++;
    }
  }

  
  trackRedis(operation, success = true) {
    this.metrics.redis.operations++;
    
    if (!success) {
      this.metrics.redis.errors++;
    }
  }

  
  trackRabbitMQ(type, success = true) {
    if (type === 'sent' && success) {
      this.metrics.rabbitmq.messages.sent++;
    } else if (type === 'received' && success) {
      this.metrics.rabbitmq.messages.received++;
    } else {
      this.metrics.rabbitmq.messages.failed++;
    }
  }

  
  trackSocket(eventType, count = 1) {
    if (eventType === 'connected') {
      this.metrics.sockets.connected += count;
    } else if (eventType === 'disconnected') {
      this.metrics.sockets.connected -= count;
    } else if (eventType === 'event') {
      this.metrics.sockets.events += count;
    } else if (eventType === 'error') {
      this.metrics.sockets.errors += count;
    }
  }

  
  checkThresholds() {
    const now = Date.now();
    
    
    const latestMemory = this.metrics.memory.usage[this.metrics.memory.usage.length - 1];
    if (latestMemory && latestMemory.percentage > this.thresholds.memory) {
      this.createAlert('HIGH_MEMORY_USAGE', `Memory usage: ${latestMemory.percentage.toFixed(2)}%`);
    }

    
    const totalRequests = this.metrics.requests.total;
    const errorRate = totalRequests > 0 ? (this.metrics.requests.errors / totalRequests) * 100 : 0;
    if (errorRate > this.thresholds.errorRate && totalRequests > 10) {
      this.createAlert('HIGH_ERROR_RATE', `Error rate: ${errorRate.toFixed(2)}%`);
    }

    
    const recentResponses = this.metrics.requests.responseTime.slice(-10);
    if (recentResponses.length > 0) {
      const avgResponseTime = recentResponses.reduce((sum, r) => sum + r.duration, 0) / recentResponses.length;
      if (avgResponseTime > this.thresholds.responseTime) {
        this.createAlert('SLOW_RESPONSE_TIME', `Average response time: ${avgResponseTime.toFixed(2)}ms`);
      }
    }
  }

  
  createAlert(type, message, severity = 'warning') {
    const alert = {
      id: `${type}_${Date.now()}`,
      type,
      message,
      severity,
      timestamp: Date.now(),
      acknowledged: false
    };

    this.alerts.push(alert);
    

    logger.warn('System alert created:', alert);
    
    
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    return alert;
  }

  
  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      logger.info('Alert acknowledged:', alertId);
      return true;
    }
    return false;
  }

  
  cleanupOldMetrics() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    
    this.metrics.memory.usage = this.metrics.memory.usage.filter(m => m.timestamp > cutoff);    
    this.metrics.cpu.usage = this.metrics.cpu.usage.filter(c => c.timestamp > cutoff);    
    this.metrics.requests.responseTime = this.metrics.requests.responseTime.filter(r => r.timestamp > cutoff);
    this.alerts = this.alerts.filter(a => a.timestamp > cutoff);
  }

  
  getMetrics() {
    return {
      timestamp: Date.now(),
      uptime: process.uptime(),
      isMonitoring: this.isMonitoring,
      requests: {
        total: this.metrics.requests.total,
        success: this.metrics.requests.success,
        errors: this.metrics.requests.errors,
        errorRate: this.metrics.requests.total > 0 
          ? ((this.metrics.requests.errors / this.metrics.requests.total) * 100).toFixed(2) + '%'
          : '0%',
        byMethod: this.metrics.requests.byMethod,
        avgResponseTime: this.getAverageResponseTime()
      },
      memory: {
        current: this.getCurrentMemoryUsage(),
        max: this.metrics.memory.maxUsage
      },
      database: this.metrics.database,
      redis: this.metrics.redis,
      rabbitmq: this.metrics.rabbitmq,
      sockets: this.metrics.sockets,
      alerts: {
        total: this.alerts.length,
        unacknowledged: this.alerts.filter(a => !a.acknowledged).length,
        recent: this.alerts.slice(-5)
      }
    };
  }

  
  getCurrentMemoryUsage() {
    const memUsage = process.memoryUsage();
    return {
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB',
      percentage: ((memUsage.heapUsed / memUsage.heapTotal) * 100).toFixed(2) + '%'
    };
  }

  
  getAverageResponseTime() {
    const recent = this.metrics.requests.responseTime.slice(-100); 
    if (recent.length === 0) return '0ms';
    
    const avg = recent.reduce((sum, r) => sum + r.duration, 0) / recent.length;
    return Math.round(avg) + 'ms';
  }

  
  getAlerts(includeAcknowledged = false) {
    return this.alerts.filter(alert => includeAcknowledged || !alert.acknowledged);
  }

  
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        errors: 0,
        byMethod: {},
        byRoute: {},
        responseTime: []
      },
      memory: {
        usage: [],
        maxUsage: 0
      },
      cpu: {
        usage: []
      },
      database: {
        connections: 0,
        queries: 0,
        errors: 0
      },
      redis: {
        connections: 0,
        operations: 0,
        errors: 0
      },
      rabbitmq: {
        messages: {
          sent: 0,
          received: 0,
          failed: 0
        }
      },
      sockets: {
        connected: 0,
        events: 0,
        errors: 0
      }
    };
    
    this.alerts = [];
    logger.info('System metrics reset');
  }

  
  generateHealthReport() {
    const metrics = this.getMetrics();
    const memoryUsage = parseFloat(metrics.memory.current.percentage);
    const errorRate = parseFloat(metrics.requests.errorRate);
    
    let health = 'healthy';
    let issues = [];
    
    if (memoryUsage > this.thresholds.memory) {
      health = 'warning';
      issues.push(`High memory usage: ${metrics.memory.current.percentage}`);
    }
    
    if (errorRate > this.thresholds.errorRate && metrics.requests.total > 10) {
      health = 'critical';
      issues.push(`High error rate: ${metrics.requests.errorRate}`);
    }
    
    if (this.alerts.filter(a => !a.acknowledged && a.severity === 'critical').length > 0) {
      health = 'critical';
      issues.push('Critical alerts present');
    }
    
    return {
      status: health,
      timestamp: Date.now(),
      uptime: process.uptime(),
      issues,
      metrics: {
        memory: metrics.memory.current,
        requests: {
          total: metrics.requests.total,
          errorRate: metrics.requests.errorRate,
          avgResponseTime: metrics.requests.avgResponseTime
        },
        alerts: metrics.alerts.unacknowledged
      }
    };
  }
}


const systemMonitor = new SystemMonitor();


const monitoringMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    systemMonitor.trackRequest(req, res, responseTime);
  });
  
  next();
};

module.exports = {
  systemMonitor,
  monitoringMiddleware,
  SystemMonitor
};