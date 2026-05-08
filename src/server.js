const app = require('./app');
const connectDB = require('./config/database');
const env = require('./config/env');
const logger = require('./utils/logger');

const start = async () => {
  try {
    await connectDB();

    app.listen(env.PORT, () => {
      logger.info(`\ud83d\ude80 Server running on http://localhost:${env.PORT} [${env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
};

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection:', err);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

start();
