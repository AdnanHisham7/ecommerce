const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('./logger');

const transporter = nodemailer.createTransport({
  host: env.email.host,
  port: env.email.port,
  secure: false,
  // secure: env.email.port === 465,
  auth: {
    user: env.email.user,
    pass: env.email.pass,
  },
  tls: {
    // This instructs nodemailer to accept self-signed certificates
    rejectUnauthorized: false 
  }
});

const sendEmail = async ({ to, subject, html, text }) => {
  try {
    const info = await transporter.sendMail({
      from: env.email.from,
      to,
      subject,
      html,
      text: text || '',
    });
    logger.info(`Email sent to ${to}: ${info.messageId}`);
    return info;
  } catch (error) {
    logger.error(`Email send failed to ${to}: ${error.message}`);
    throw error;
  }
};

const emailTemplates = {
  otp: (name, otp) => ({
    subject: `Your OTP - ${env.app.name}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;">
          <img
            src="${env.app.logoPublicUrl}"
            alt="${env.app.name}"
            width="64"
            height="64"
            style="border-radius:50%;display:block;margin:0 auto 12px auto;"
          />
          <h1 style="color:#ef4444;margin:0;font-size:28px;">
            ${env.app.name}
          </h1>
        </div>
        <div style="padding:40px;">
          <h2 style="color:#333;margin-bottom:10px;">Hi ${name},</h2>
          <p style="color:#666;font-size:16px;">Your OTP for verification is:</p>
          <div style="background:#f8f8f8;border:2px dashed #f0a500;border-radius:8px;padding:20px;text-align:center;margin:20px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1a1a2e;">${otp}</span>
          </div>
          <p style="color:#666;font-size:14px;">This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
          <p style="color:#999;font-size:12px;margin-top:30px;">If you didn't request this, please ignore this email.</p>
        </div>
        <div style="background:#f8f8f8;padding:20px;text-align:center;">
          <p style="color:#999;font-size:12px;margin:0;">© ${new Date().getFullYear()} ${env.app.name}. All rights reserved.</p>
        </div>
      </div></body></html>
    `,
  }),

  welcomeEmail: (name) => ({
    subject: `Welcome to ${env.app.name}! 🎉`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;">
          <img
            src="${env.app.logoPublicUrl}"
            alt="${env.app.name}"
            width="64"
            height="64"
            style="border-radius:50%;display:block;margin:0 auto 12px auto;"
          />
          <h1 style="color:#ef4444;margin:0;font-size:28px;">
            ${env.app.name}
          </h1>
        </div>
        <div style="padding:40px;text-align:center;">
          <h2 style="color:#333;">Welcome, ${name}! 🎊</h2>
          <p style="color:#666;font-size:16px;">Your account has been created successfully. Start exploring our collection of premium football gear!</p>
          <a href="${env.app.url}" style="display:inline-block;background:linear-gradient(135deg,#f0a500,#e09400);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;margin-top:20px;font-size:16px;">Shop Now →</a>
        </div>
      </div></body></html>
    `,
  }),

  orderConfirmation: (name, order) => ({
    subject: `Order Confirmed #${order.orderNumber} - ${env.app.name}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;">
          <img
            src="${env.app.logoPublicUrl}"
            alt="${env.app.name}"
            width="64"
            height="64"
            style="border-radius:50%;display:block;margin:0 auto 12px auto;"
          />
          <h1 style="color:#ef4444;margin:0;font-size:28px;">
            ${env.app.name}
          </h1>
        </div>
        <div style="padding:40px;">
          <h2 style="color:#333;">Order Confirmed! ✅</h2>
          <p style="color:#666;">Hi ${name}, your order <strong>#${order.orderNumber}</strong> has been placed successfully.</p>
          <div style="background:#f8f8f8;border-radius:8px;padding:20px;margin:20px 0;">
            <p style="margin:0;color:#333;"><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
            <p style="margin:5px 0 0;color:#333;"><strong>Payment Status:</strong> ${order.paymentStatus}</p>
          </div>
          <a href="${env.app.url}/orders/${order._id}" style="display:inline-block;background:linear-gradient(135deg,#f0a500,#e09400);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;margin-top:20px;">Track Order →</a>
        </div>
      </div></body></html>
    `,
  }),

  passwordReset: (name, resetUrl) => ({
    subject: `Password Reset Request - ${env.app.name}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;">
          <img
            src="${env.app.logoPublicUrl}"
            alt="${env.app.name}"
            width="64"
            height="64"
            style="border-radius:50%;display:block;margin:0 auto 12px auto;"
          />
          <h1 style="color:#ef4444;margin:0;font-size:28px;">
            ${env.app.name}
          </h1>
        </div>
        <div style="padding:40px;">
          <h2 style="color:#333;">Password Reset Request</h2>
          <p style="color:#666;">Hi ${name}, you requested a password reset. Click the button below to reset your password.</p>
          <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(135deg,#f0a500,#e09400);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:bold;margin-top:20px;">Reset Password →</a>
          <p style="color:#999;font-size:12px;margin-top:20px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
      </div></body></html>
    `,
  }),

  loginAlert: (name, ip, device) => ({
    subject: `New Login Detected - ${env.app.name}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#dc2626,#991b1b);padding:30px;text-align:center;">
          <h1 style="color:#fff;margin:0;font-size:28px;">⚠️ Security Alert</h1>
        </div>
        <div style="padding:40px;">
          <h2 style="color:#333;">New Login to Your Account</h2>
          <p style="color:#666;">Hi ${name}, a new login was detected on your account.</p>
          <div style="background:#fef2f2;border-left:4px solid #dc2626;border-radius:4px;padding:16px;margin:20px 0;">
            <p style="margin:0;color:#333;"><strong>IP Address:</strong> ${ip}</p>
            <p style="margin:5px 0 0;color:#333;"><strong>Device:</strong> ${device}</p>
            <p style="margin:5px 0 0;color:#333;"><strong>Time:</strong> ${new Date().toLocaleString()}</p>
          </div>
          <p style="color:#666;">If this wasn't you, please change your password immediately and contact support.</p>
        </div>
      </div></body></html>
    `,
  }),

  referralBonus: (name, amount, referralCode) => ({
    subject: `You've earned a referral bonus! 🎁 - ${env.app.name}`,
    html: `
      <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f4f4;margin:0;padding:0;">
      <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
        <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:30px;text-align:center;">
          <img
            src="${env.app.logoPublicUrl}"
            alt="${env.app.name}"
            width="64"
            height="64"
            style="border-radius:50%;display:block;margin:0 auto 12px auto;"
          />
          <h1 style="color:#ef4444;margin:0;font-size:28px;">
            ${env.app.name}
          </h1>
        </div>
        <div style="padding:40px;text-align:center;">
          <h2 style="color:#333;">🎁 Referral Bonus Earned!</h2>
          <p style="color:#666;">Hi ${name}, someone used your referral code!</p>
          <div style="background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;padding:20px;margin:20px 0;">
            <p style="font-size:24px;font-weight:bold;color:#16a34a;margin:0;">+₹${amount} Added to Wallet</p>
          </div>
          <p style="color:#666;">Your referral code: <strong style="background:#f8f8f8;padding:4px 12px;border-radius:4px;letter-spacing:2px;">${referralCode}</strong></p>
        </div>
      </div></body></html>
    `,
  }),
};

module.exports = { sendEmail, emailTemplates };
