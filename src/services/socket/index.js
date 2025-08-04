const socketAuthMiddleware = require('./authMiddleware');
const SocketHandler = require('./socketHandler');
const logger = require('../../utils/logger');

function initializeSocket(io) {
  
  io.use(socketAuthMiddleware);

  
  const socketHandler = new SocketHandler(io);

  
  io.on('connection', (socket) => {
    
    socketHandler.handleConnection(socket);

    
    socket.on('join_room', (data) => {
      socketHandler.handleJoinRoom(socket, data);
    });

    socket.on('send_message', (data) => {
      socketHandler.handleSendMessage(socket, data);
    });

    socket.on('typing', (data) => {
      socketHandler.handleTyping(socket, data);
    });

    socket.on('message_read', (data) => {
      socketHandler.handleMessageRead(socket, data);
    });

    socket.on('get_online_users', () => {
      socketHandler.handleGetOnlineUsers(socket);
    });

    
    socket.on('disconnect', () => {
      socketHandler.handleDisconnection(socket);
    });

    
    socket.on('connect_error', (error) => {
      logger.error('Socket connection error:', error);
    });

    
    socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  });

  
  io.engine.on('connection_error', (err) => {
    logger.error('Socket authentication error:', {
      message: err.message,
      type: err.type,
      description: err.description,
      context: err.context
    });
  });

  logger.info('Socket.IO initialized successfully');
  
  
  return socketHandler;
}

module.exports = initializeSocket;