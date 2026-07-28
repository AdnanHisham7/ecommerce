# E-Commerce Platform

A server-side rendered (SSR) e-commerce application built with Node.js, Express, MongoDB, and EJS. The codebase uses a feature-based, modular architecture designed for maintainability and clear separation of concerns.

---

## Technical Stack

* **Runtime & Framework:** Node.js (v18+), Express.js
* **Database:** MongoDB with Mongoose ODM
* **Templating Engine:** EJS with `ejs-mate` layouts
* **Authentication:** JWT (HTTP-only cookies), Google OAuth 2.0, Speakeasy (2FA TOTP), Passport.js
* **Payment Gateway:** Razorpay (Order creation & HMAC-SHA256 signature verification)
* **Real-time Engine:** Socket.IO
* **Storage & Uploads:** Cloudinary, Multer
* **Logging & Security:** Winston, Helmet, CSRF (`csurf`), Rate Limiting, Mongo Sanitize

---

## Core Features

### Storefront & Customer Experience

* **Product Catalog:** Multi-attribute filtering (category, price, rating, offers), sorting, pagination, and live search autocomplete.
* **Product Detail:** Variant management (size, color, SKU), specifications, customer reviews/ratings, and related item recommendations.
* **Cart & Checkout:** Quantity management, coupon application, integrated wallet payments, Cash on Delivery (COD), and Razorpay checkout modal integration.
* **Order Management:** Real-time tracking timeline, partial item cancellation, failed payment retries, and automated PDF invoice generation via PDFKit.
* **User Accounts:** OTP email verification during registration, address book management, order history, wishlist, and wallet transaction history (including referral bonuses).
* **Security & Auth:** Two-factor authentication (TOTP via authenticator apps), rate-limited login routes, account lockout policies after failed attempts, and login activity notifications.

### Admin Panel (`/admin`)

* **Dashboard & Analytics:** Revenue graphs, order velocity metrics, top-selling categories, and user growth charts using Chart.js.
* **Catalog Management:** Full CRUD for nested categories, multi-image product uploads, SKU and inventory tracking, and custom SEO metadata fields.
* **Promotions Engine:** Percentage/fixed discount coupons with usage constraints, product/category-level offer rules, and store banner management.
* **Operations:** Order workflow management, low-stock dashboard alerts, staff role access control (RBAC), and append-only activity audit logs.

---

## Directory Structure

```
ecommerce/
├── src/
│   ├── app.js                   # Express application setup & middleware configuration
│   ├── server.js                # HTTP server initiation & Socket.IO initialization
│   ├── config/
│   │   ├── env.js               # Environment variables validation & export
│   │   ├── database.js          # MongoDB connection handler
│   │   ├── session.js           # Session store configuration
│   │   ├── passport.js          # Authentication strategies (Local, Google)
│   │   └── cloudinary.js        # Media storage service setup
│   ├── modules/
│   │   ├── auth/                # Auth logic, JWT helpers, 2FA, password resets
│   │   ├── users/               # Profile management, address book, wallet
│   │   ├── products/            # Catalog, variants, reviews, inventory
│   │   ├── categories/          # Category taxonomy
│   │   ├── cart/                # Session and database cart operations
│   │   ├── orders/              # Checkout logic, Razorpay webhooks, PDF generation
│   │   ├── wishlist/            # User wishlist handling
│   │   ├── coupons/             # Discount rules and validation engine
│   │   ├── offers/              # Automatic product/category discount logic
│   │   ├── banners/             # Site banner state management
│   │   └── admin/               # Admin routes, controllers, and analytics
│   ├── middlewares/
│   │   ├── auth.middleware.js   # JWT verification & session guards
│   │   ├── error.middleware.js  # Centralized error handler
│   │   └── rateLimit.js         # Endpoint rate limiting rules
│   ├── utils/
│   │   ├── ApiError.js          # Custom error extension
│   │   ├── asyncHandler.js      # Express async route wrapper
│   │   ├── email.js             # Nodemailer setup for transactional emails
│   │   ├── logger.js            # Winston logging streams
│   │   └── razorpay.js          # Razorpay client instance & signature verification
│   ├── views/                   # EJS templates (layouts, partials, pages)
│   └── public/                  # Static assets (CSS, client JS, PWA assets)
└── package.json

```

---

## Environment Variables

Create a `.env` file in the root directory based on the following template:

```env
# Server
PORT=3000
NODE_ENV=development
APP_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb://127.0.0.1:27017/ecommerce

# Authentication
JWT_ACCESS_SECRET=your_jwt_access_secret_key
JWT_REFRESH_SECRET=your_jwt_refresh_secret_key
SESSION_SECRET=your_session_secret_key

# OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Razorpay Integration
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_razorpay_webhook_secret

# Cloudinary Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Mailer (SMTP)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=noreply@ecommerce.com

```

---

## Getting Started

### Prerequisites

* Node.js v18.0.0 or higher
* MongoDB instance (Local or Atlas)
* Active Razorpay account for API keys

### Installation Steps

1. **Clone the repository:**
```bash
git clone https://github.com/your-username/ecommerce.git
cd ecommerce

```


2. **Install dependencies:**
```bash
npm install

```


3. **Configure environment:**
```bash
cp .env.example .env
# Populate .env with required keys

```


4. **Seed database (Optional):**
```bash
npm run seed

```


5. **Start the development server:**
```bash
npm run dev

```



---

## Development Scripts

| Command | Action |
| --- | --- |
| `npm start` | Starts the production server (`node src/server.js`) |
| `npm run dev` | Runs the server with auto-reload (`nodemon src/server.js`) |
| `npm run seed` | Seeds initial category and admin user data |
| `npm run lint` | Runs ESLint check across JavaScript files |

---

## Security Implementation Highlights

* **Payment Security:** Order payment validation uses Razorpay HMAC-SHA256 signature verification server-side prior to mutating order state.
* **Authentication:** Dual-token strategy (short-lived access tokens, refresh tokens with rotation stored in HTTP-only, SameSite cookies).
* **Data Sanitization:** Input sanitization against NoSQL injection via `express-mongo-sanitize` and parameter pollution prevention via `hpp`.
* **Rate Limiting:** Granular rate limits applied to authentication, OTP generation, API calls, and payment endpoints.

---

## License

This project is licensed under the MIT License.