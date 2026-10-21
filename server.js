const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Coupon = require('./models/Coupon');
const { sendOTPEmail } = require('./utils/mailer');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dadai_super_secret_key_2026';

app.use(cors());
app.use(express.json());

// Seed default coupons if not present
async function seedDefaultCoupons() {
  try {
    const defaultCoupons = [
      { code: 'DADAI24', description: 'Official 24-Hour Access Pass', durationHours: 24, maxUses: -1 },
      { code: 'FREE24', description: 'Promotional 24-Hour Trial Pass', durationHours: 24, maxUses: -1 },
      { code: 'DEV24', description: 'Developer 24-Hour Test Key', durationHours: 24, maxUses: -1 }
    ];

    for (const c of defaultCoupons) {
      const exists = await Coupon.findOne({ code: c.code });
      if (!exists) {
        await Coupon.create(c);
        console.log(`[coupons] Seeded default coupon: ${c.code}`);
      }
    }
  } catch (err) {
    console.error('[coupons] Error seeding coupons:', err.message);
  }
}

// Connect to MongoDB Atlas
const rawMongoUri = (process.env.MONGODB_URI || '').replace(/^["']|["']$/g, '').trim();
if (rawMongoUri) {
  mongoose.connect(rawMongoUri, {
    serverSelectionTimeoutMS: 8000
  })
    .then(async () => {
      console.log('[database] Successfully connected to MongoDB Atlas');
      await seedDefaultCoupons();
    })
    .catch(err => console.error('[database] MongoDB connection error:', err.message));
} else {
  console.warn('[database] Warning: MONGODB_URI not defined');
}

// Authentication Middleware
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Authentication token required' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ success: false, error: 'User account not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ success: false, error: 'Invalid or expired session token' });
  }
}

// Helper: Generate signed machine license token
function generateMachineLicense(user, hwid, expiresAt) {
  return jwt.sign({
    sub: user._id,
    email: user.email,
    hwid: hwid,
    plan: '24hr',
    expiresAt: expiresAt.toISOString ? expiresAt.toISOString() : new Date(expiresAt).toISOString(),
    issuedAt: Date.now(),
    type: 'dadai-machine-license'
  }, JWT_SECRET);
}

// 1. Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date() });
});

// 2. Request OTP (Signup or Login)
// Stores credentials (email) on DB if user doesn't already exist
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Please enter a valid email address.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let user = await User.findOne({ email: normalizedEmail });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (!user) {
      // New user signup: Store email in database
      user = new User({
        email: normalizedEmail,
        isVerified: false,
        otp: { code: otpCode, expiresAt }
      });
      console.log(`[auth:signup] Registering new user: ${normalizedEmail}`);
    } else {
      // Existing user login
      user.otp = { code: otpCode, expiresAt };
      console.log(`[auth:login] Generating OTP for existing user: ${normalizedEmail}`);
    }

    await user.save();

    // Dispatch email asynchronously via Google Webhook (Instant UI response)
    sendOTPEmail(normalizedEmail, otpCode).catch(mailErr => {
      console.error(`[send-otp:error] Background email delivery failed to ${normalizedEmail}:`, mailErr.message);
    });

    res.json({
      success: true,
      message: 'Verification code sent to your email.'
    });
  } catch (err) {
    console.error('[send-otp] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to generate verification code' });
  }
});

// 3. Verify OTP & Check Subscription + Device Lock
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp, hwid, deviceInfo } = req.body;
    if (!email || !otp) return res.status(400).json({ success: false, error: 'Email and OTP required' });

    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(404).json({ success: false, error: 'Account not found' });

    if (!user.otp || !user.otp.code || user.otp.code !== otp.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid verification code' });
    }

    if (new Date() > new Date(user.otp.expiresAt)) {
      return res.status(400).json({ success: false, error: 'Verification code has expired. Please request a new one.' });
    }

    // Mark verified and clear OTP
    user.isVerified = true;
    user.otp = { code: null, expiresAt: null };

    // Record rich device details (Username, OS, Hostname, CPU, RAM)
    if (deviceInfo) {
      user.deviceInfo = {
        osUsername: deviceInfo.username || deviceInfo.osUsername || user.deviceInfo?.osUsername || null,
        os: deviceInfo.os || user.deviceInfo?.os || null,
        osVersion: deviceInfo.osVersion || user.deviceInfo?.osVersion || null,
        osArch: deviceInfo.osArch || user.deviceInfo?.osArch || null,
        platform: deviceInfo.platform || user.deviceInfo?.platform || null,
        hostname: deviceInfo.hostname || user.deviceInfo?.hostname || null,
        cpuModel: deviceInfo.cpuModel || user.deviceInfo?.cpuModel || null,
        totalMemory: deviceInfo.totalMemory || user.deviceInfo?.totalMemory || null,
        lastSeenAt: new Date()
      };
    }

    await user.save();

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    // Evaluate Subscription & Hardware Binding Status
    const hasSub = user.hasActiveSubscription();
    const boundHwid = user.subscription ? user.subscription.boundHwid : user.registeredHwid;

    // Case 1: Subscription active AND same device -> User is ready to launch!
    if (hasSub && hwid && boundHwid === hwid) {
      const license = generateMachineLicense(user, hwid, user.subscription.expiresAt);
      return res.json({
        success: true,
        token,
        state: 'ready',
        message: 'Active subscription verified for this computer.',
        expiresAt: user.subscription.expiresAt,
        license,
        user: { email: user.email, registeredHwid: user.registeredHwid, deviceInfo: user.deviceInfo }
      });
    }

    // Case 2: Subscription is active BUT user has changed device!
    // Rule: "if the user has changed the device and subscription is still active ask to buy again"
    if (hasSub && hwid && boundHwid && boundHwid !== hwid) {
      return res.json({
        success: true,
        token,
        state: 'device_changed',
        hasActiveSubscriptionOnOtherDevice: true,
        message: 'Active 24hr subscription found on another computer. DadAI licenses are locked per device. To use DadAI on this computer, please purchase a new 24hr pass (₹50) or enter a valid coupon.',
        user: { email: user.email, registeredHwid: boundHwid, deviceInfo: user.deviceInfo }
      });
    }

    // Case 3: No active subscription (new signup or expired subscription)
    return res.json({
      success: true,
      token,
      state: 'needs_subscription',
      isExpired: !!(user.subscription && user.subscription.expiresAt),
      message: 'Please purchase a 24hr access pass (₹50) or enter a coupon code to activate DadAI.',
      user: { email: user.email, registeredHwid: user.registeredHwid, deviceInfo: user.deviceInfo }
    });
  } catch (err) {
    console.error('[verify-otp] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
});

// 4. Check Current Subscription Status
app.post('/api/subscription/status', authenticateToken, async (req, res) => {
  try {
    const { hwid } = req.body;
    const user = req.user;
    const hasSub = user.hasActiveSubscription();
    const boundHwid = user.subscription ? user.subscription.boundHwid : user.registeredHwid;
    const isThisDevice = hasSub && boundHwid === hwid;

    res.json({
      success: true,
      hasActiveSubscription: hasSub,
      isActiveForThisDevice: isThisDevice,
      boundHwid,
      expiresAt: user.subscription ? user.subscription.expiresAt : null,
      remainingMs: user.subscription && user.subscription.expiresAt
        ? Math.max(0, new Date(user.subscription.expiresAt).getTime() - Date.now())
        : 0
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch subscription status' });
  }
});

// 5. Apply Coupon & Activate 24hr Subscription
// If coupon is valid, grants 24hr subscription locked to current machine hwid
app.post('/api/subscription/apply-coupon', authenticateToken, async (req, res) => {
  try {
    const { coupon: couponCode, hwid, deviceInfo } = req.body;
    if (!couponCode || !couponCode.trim()) {
      return res.status(400).json({ success: false, error: 'Please enter a coupon code.' });
    }
    if (!hwid || hwid.length < 16) {
      return res.status(400).json({ success: false, error: 'Valid hardware identifier (HWID) required.' });
    }

    const normalizedCode = couponCode.trim().toUpperCase();
    const coupon = await Coupon.findOne({ code: normalizedCode, isActive: true });

    if (!coupon) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coupon code. Please contact developer to purchase 24-hr access for ₹50 or get an activation coupon.'
      });
    }

    if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) {
      return res.status(400).json({
        success: false,
        error: 'This coupon code has reached its maximum redemptions limit.'
      });
    }

    const user = req.user;

    // Archive current subscription if present
    if (user.subscription && user.subscription.expiresAt) {
      user.subscriptionHistory.push(user.subscription);
    }

    // Activate 24 hours (or coupon specified duration) from now
    const durationHours = coupon.durationHours || 24;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

    const devUser = deviceInfo ? (deviceInfo.username || deviceInfo.osUsername) : null;
    const devOs = deviceInfo ? deviceInfo.os : null;

    user.subscription = {
      plan: '24hr',
      price: 50,
      status: 'active',
      boundHwid: hwid,
      startedAt: now,
      expiresAt: expiresAt,
      activatedVia: 'coupon',
      couponUsed: coupon.code,
      boundDeviceUser: devUser,
      boundDeviceOS: devOs
    };

    user.registeredHwid = hwid;
    user.deviceRegisteredAt = now;

    if (deviceInfo) {
      user.deviceInfo = {
        osUsername: devUser || user.deviceInfo?.osUsername || null,
        os: devOs || user.deviceInfo?.os || null,
        osVersion: deviceInfo.osVersion || user.deviceInfo?.osVersion || null,
        osArch: deviceInfo.osArch || user.deviceInfo?.osArch || null,
        platform: deviceInfo.platform || user.deviceInfo?.platform || null,
        hostname: deviceInfo.hostname || user.deviceInfo?.hostname || null,
        cpuModel: deviceInfo.cpuModel || user.deviceInfo?.cpuModel || null,
        totalMemory: deviceInfo.totalMemory || user.deviceInfo?.totalMemory || null,
        lastSeenAt: now
      };
    }

    await user.save();

    // Increment coupon usage
    coupon.usedCount += 1;
    await coupon.save();

    console.log(`[subscription] Activated 24hr subscription for ${user.email} on HWID ${hwid} (User: ${devUser || 'N/A'}, OS: ${devOs || 'N/A'}) using coupon ${coupon.code}`);

    // Generate signed machine license token
    const license = generateMachineLicense(user, hwid, expiresAt);

    res.json({
      success: true,
      message: `24-Hour Subscription successfully activated! Valid until ${expiresAt.toLocaleString()}`,
      expiresAt,
      license,
      user: {
        email: user.email,
        registeredHwid: user.registeredHwid,
        subscription: user.subscription,
        deviceInfo: user.deviceInfo
      }
    });
  } catch (err) {
    console.error('[apply-coupon] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to apply coupon' });
  }
});

// 6. Runtime Heartbeat & Expiration Verification
app.post('/api/device/verify', async (req, res) => {
  try {
    const { license, hwid, deviceInfo } = req.body;
    if (!license || !hwid) return res.status(400).json({ valid: false, error: 'License and HWID required' });

    const decoded = jwt.verify(license, JWT_SECRET);

    // 1. Hardware lock check
    if (decoded.hwid !== hwid) {
      return res.status(403).json({
        valid: false,
        error: 'Hardware mismatch. License cannot be transferred to this device.'
      });
    }

    // 2. Expiration check (24hr pass limit)
    const expiresAt = new Date(decoded.expiresAt);
    if (Date.now() > expiresAt.getTime()) {
      return res.status(403).json({
        valid: false,
        expired: true,
        error: 'Your 24-hour subscription has expired. Please renew or purchase a new pass.'
      });
    }

    // 3. User integrity check in DB
    const user = await User.findById(decoded.sub);
    if (!user) {
      return res.status(403).json({ valid: false, error: 'User account not found.' });
    }

    if (!user.isActiveForDevice(hwid)) {
      return res.status(403).json({
        valid: false,
        error: 'Subscription has been transferred, revoked, or expired on this machine.'
      });
    }

    if (deviceInfo) {
      user.deviceInfo = {
        osUsername: deviceInfo.username || deviceInfo.osUsername || user.deviceInfo?.osUsername || null,
        os: deviceInfo.os || user.deviceInfo?.os || null,
        osVersion: deviceInfo.osVersion || user.deviceInfo?.osVersion || null,
        osArch: deviceInfo.osArch || user.deviceInfo?.osArch || null,
        platform: deviceInfo.platform || user.deviceInfo?.platform || null,
        hostname: deviceInfo.hostname || user.deviceInfo?.hostname || null,
        cpuModel: deviceInfo.cpuModel || user.deviceInfo?.cpuModel || null,
        totalMemory: deviceInfo.totalMemory || user.deviceInfo?.totalMemory || null,
        lastSeenAt: new Date()
      };
      await user.save();
    }

    const remainingMs = Math.max(0, expiresAt.getTime() - Date.now());

    res.json({
      valid: true,
      email: user.email,
      expiresAt: user.subscription.expiresAt,
      remainingMinutes: Math.floor(remainingMs / 60000),
      apiKey: process.env.GEMINI_API_KEY || ''
    });
  } catch (err) {
    res.status(403).json({ valid: false, error: 'Invalid or corrupt machine license' });
  }
});

// 7. Secure API Key Delivery for Verified Subscription
app.post('/api/device/get-api-key', async (req, res) => {
  try {
    const { license, hwid, deviceInfo } = req.body;
    if (!license || !hwid) return res.status(400).json({ success: false, error: 'License and HWID required' });

    const decoded = jwt.verify(license, JWT_SECRET);

    if (decoded.hwid !== hwid) {
      return res.status(403).json({ success: false, error: 'Hardware mismatch detected.' });
    }

    const expiresAt = new Date(decoded.expiresAt);
    if (Date.now() > expiresAt.getTime()) {
      return res.status(403).json({ success: false, expired: true, error: 'Subscription has expired.' });
    }

    const user = await User.findById(decoded.sub);
    if (!user || !user.isActiveForDevice(hwid)) {
      return res.status(403).json({ success: false, error: 'Subscription is inactive or transferred.' });
    }

    if (deviceInfo) {
      user.deviceInfo = {
        osUsername: deviceInfo.username || deviceInfo.osUsername || user.deviceInfo?.osUsername || null,
        os: deviceInfo.os || user.deviceInfo?.os || null,
        osVersion: deviceInfo.osVersion || user.deviceInfo?.osVersion || null,
        osArch: deviceInfo.osArch || user.deviceInfo?.osArch || null,
        platform: deviceInfo.platform || user.deviceInfo?.platform || null,
        hostname: deviceInfo.hostname || user.deviceInfo?.hostname || null,
        cpuModel: deviceInfo.cpuModel || user.deviceInfo?.cpuModel || null,
        totalMemory: deviceInfo.totalMemory || user.deviceInfo?.totalMemory || null,
        lastSeenAt: new Date()
      };
      await user.save();
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: 'Gemini API key is not configured on the server.' });
    }

    res.json({
      success: true,
      apiKey: process.env.GEMINI_API_KEY,
      expiresAt: user.subscription.expiresAt,
      remainingMinutes: Math.floor(Math.max(0, expiresAt.getTime() - Date.now()) / 60000)
    });
  } catch (err) {
    res.status(403).json({ success: false, error: 'Invalid or corrupt machine license' });
  }
});

app.listen(PORT, () => {
  console.log(`[server] DadAI Licensing & Subscription Server running on port ${PORT}`);
});
