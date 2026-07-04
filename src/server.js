const http = require('http');
const { Server } = require('socket.io');
const app = require('./app');
const connectDB = require('./config/database');
const env = require('./config/env');
const logger = require('./utils/logger');

const server = http.createServer(app);

// ====== Socket.IO for real-time notifications ======
const io = new Server(server, {
  cors: { origin: env.app.url, methods: ['GET', 'POST'] },
});

io.on('connection', (socket) => {
  logger.info(`Socket connected: ${socket.id}`);

  socket.on('join_user', (userId) => {
    socket.join(`user_${userId}`);
    logger.info(`User ${userId} joined socket room`);
  });

  socket.on('join_admin', () => {
    socket.join('admin_room');
  });

  socket.on('disconnect', () => {
    logger.info(`Socket disconnected: ${socket.id}`);
  });
});

// Make io accessible globally
app.set('io', io);
global.io = io;

// ====== Start ======
const start = async () => {
  try {
    await connectDB();

    server.listen(env.PORT, () => {
      logger.info(`🚀 Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
      logger.info(`📦 Admin panel: http://localhost:${env.PORT}/admin/login`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  server.close(() => process.exit(1));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

start();
