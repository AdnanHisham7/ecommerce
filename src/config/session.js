const session = require('express-session');
const MongoStore = require('connect-mongo');
const env = require('./env');

const sessionConfig = {
  secret: env.session.secret,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: env.mongodb.uri,
    collectionName: 'sessions',
    ttl: 7 * 24 * 60 * 60, // 7 days
    autoRemove: 'native',
  }),
  cookie: {
    secure: env.isProd,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: env.isProd ? 'strict' : 'lax',
  },
  name: 'fs.sid',
};

module.exports = sessionConfig;
