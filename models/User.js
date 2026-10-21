const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  plan: {
    type: String,
    default: '24hr'
  },
  price: {
    type: Number,
    default: 50
  },
  status: {
    type: String,
    enum: ['none', 'active', 'expired'],
    default: 'none'
  },
  boundHwid: {
    type: String,
    default: null
  },
  startedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    default: null
  },
  activatedVia: {
    type: String,
    enum: ['coupon', 'payment', 'admin'],
    default: 'coupon'
  },
  couponUsed: {
    type: String,
    default: null
  },
  boundDeviceUser: {
    type: String,
    default: null
  },
  boundDeviceOS: {
    type: String,
    default: null
  }
}, { _id: false });

const deviceInfoSchema = new mongoose.Schema({
  osUsername: { type: String, default: null },
  os: { type: String, default: null },
  osVersion: { type: String, default: null },
  osArch: { type: String, default: null },
  platform: { type: String, default: null },
  hostname: { type: String, default: null },
  cpuModel: { type: String, default: null },
  totalMemory: { type: String, default: null },
  lastSeenAt: { type: Date, default: null }
}, { _id: false });

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  otp: {
    code: { type: String, default: null },
    expiresAt: { type: Date, default: null }
  },
  registeredHwid: {
    type: String,
    default: null
  },
  deviceRegisteredAt: {
    type: Date,
    default: null
  },
  deviceInfo: {
    type: deviceInfoSchema,
    default: () => ({})
  },
  subscription: {
    type: subscriptionSchema,
    default: () => ({ status: 'none', plan: '24hr', price: 50 })
  },
  subscriptionHistory: [subscriptionSchema],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Helper: Check if user has an active, unexpired subscription
userSchema.methods.hasActiveSubscription = function() {
  if (!this.subscription || !this.subscription.expiresAt) return false;
  return new Date(this.subscription.expiresAt) > new Date();
};

// Helper: Check if active subscription matches the current device HWID
userSchema.methods.isActiveForDevice = function(hwid) {
  if (!this.hasActiveSubscription()) return false;
  return this.subscription.boundHwid === hwid;
};

module.exports = mongoose.model('User', userSchema);
