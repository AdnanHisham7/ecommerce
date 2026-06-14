const express = require("express");
const path = require("path");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const passport = require("./config/passport");

const sessionConfig = require("./config/session");
const injectLocals = require("./middlewares/locals.middleware");
const routes = require("./routes/index");
const {
  notFound,
  normalizeError,
  globalErrorHandler,
} = require("./middlewares/error.middleware");
const logger = require("./utils/logger");
const env = require("./config/env");

const app = express();

// ====== Body Parsing ======
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());

// ====== Logging ======
if (env.isDev) app.use(morgan("dev"));
else
  app.use(
    morgan("combined", { stream: { write: (msg) => logger.http(msg.trim()) } }),
  );

// ====== Static Files ======
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: env.isProd ? "7d" : 0,
  }),
);

// ====== Session & Auth ======
app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// ====== View Engine ======
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ====== Inject common view data ======
app.use(injectLocals);

// ====== Routes ======
app.use(routes);

// ====== Error Handling ======
app.use(notFound);
app.use(normalizeError);
app.use(globalErrorHandler);

module.exports = app;
