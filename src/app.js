const express = require("express");
const path = require("path");
const morgan = require("morgan");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const mongoSanitize = require("express-mongo-sanitize");
const hpp = require("hpp");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const ejsMate = require("ejs-mate");
const session = require("express-session");
const passport = require("./config/passport");

const sessionConfig = require("./config/session");
const routes = require("./routes/index");
const injectLocals = require("./middlewares/locals.middleware");
const { maintenanceGuard } = require("./middlewares/auth.middleware");
const {
  notFound,
  normalizeError,
  globalErrorHandler,
} = require("./middlewares/error.middleware");
const { apiLimiter } = require("./middlewares/rateLimit.middleware");
const logger = require("./utils/logger");
const env = require("./config/env");

const app = express();

// ====== Security Middleware ======
// ====== Security Middleware ======
app.use(helmet({ crossOriginEmbedderPolicy: false }));

app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com",
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdnjs.cloudflare.com",
      ],
      scriptSrcAttr: ["'unsafe-inline'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://checkout.razorpay.com",
        "https://api.razorpay.com",
        "https://www.google-analytics.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.onesignal.com",
        "https://api.onesignal.com",
        "blob:",
        "https://cdn.jsdelivr.net",
      ],
      frameSrc: [
        "'self'",
        "https://checkout.razorpay.com",
        "https://api.razorpay.com",
      ],
      connectSrc: [
        "'self'",
        "https://checkout.razorpay.com",
        "https://api.razorpay.com",
        "https://lumberjack.razorpay.com",
        "https://www.google-analytics.com",
        "https://cdnjs.cloudflare.com",
        "ws://localhost:3000",
        "wss:",
        "wss://*",
        "https://onesignal.com",
        "https://cdn.onesignal.com",
        "https://api.onesignal.com",
      ],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      workerSrc: [
        "'self'", 
        "blob:", 
        "https://cdn.onesignal.com", 
        "https://api.onesignal.com"
      ],
    },
  })
);

app.use(cors({ origin: env.app.url, credentials: true }));
app.use(mongoSanitize());
app.use(hpp());

// ====== Body Parsing ======
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(cookieParser());
app.use(compression());

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

// ====== Global Rate Limiting ======
app.use("/api", apiLimiter);

// ====== Inject common view data (includes featureFlags) ======
app.use(injectLocals);

// ====== Maintenance mode guard (runs after injectLocals so flags are ready) ======
app.use(maintenanceGuard);

// ====== Routes ======
app.use(routes);

// ====== Error Handling ======
app.use(notFound);
app.use(normalizeError);
app.use(globalErrorHandler);

module.exports = app;
