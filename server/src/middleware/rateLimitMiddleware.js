/**
 * Rate limiting middleware to prevent brute force attacks on room access
 * Tracks failed attempts per IP and blocks after threshold is exceeded
 */

class RateLimitStore {
  constructor() {
    // Map of IP -> { attempts: number, windowStart: timestamp, blocked: boolean, blockedUntil: timestamp }
    this.attempts = new Map();
    
    // Configuration
    this.maxAttempts = 5; // Max failed attempts per window
    this.windowMs = 15 * 60 * 1000; // 15 minutes window
    this.blockDurationMs = 60 * 60 * 1000; // 1 hour block duration
    
    // Cleanup old entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  getClientId(req) {
    // Get real IP address, considering proxy headers
    return req.ip || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           'unknown';
  }

  isBlocked(clientId) {
    const record = this.attempts.get(clientId);
    if (!record) return false;

    const now = Date.now();
    
    // Check if block period has expired
    if (record.blocked && record.blockedUntil && now > record.blockedUntil) {
      // Block expired, reset the record
      this.attempts.delete(clientId);
      return false;
    }

    return record.blocked;
  }

  recordFailedAttempt(clientId) {
    const now = Date.now();
    const record = this.attempts.get(clientId) || { 
      attempts: 0, 
      windowStart: now, 
      blocked: false 
    };

    // Check if we're in a new time window
    if (now - record.windowStart > this.windowMs) {
      // Reset for new window
      record.attempts = 0;
      record.windowStart = now;
      record.blocked = false;
      record.blockedUntil = null;
    }

    // Increment attempts
    record.attempts++;

    // Check if threshold exceeded
    if (record.attempts >= this.maxAttempts) {
      record.blocked = true;
      record.blockedUntil = now + this.blockDurationMs;
      console.warn(`⚠️  IP ${clientId} blocked for brute force attempts (${record.attempts} failed room access attempts)`);
    }

    this.attempts.set(clientId, record);
    
    return {
      attempts: record.attempts,
      maxAttempts: this.maxAttempts,
      blocked: record.blocked,
      timeUntilReset: record.windowStart + this.windowMs - now,
      blockedUntil: record.blockedUntil
    };
  }

  recordSuccessfulAttempt(clientId) {
    // Successful access - reset the counter for this IP
    this.attempts.delete(clientId);
  }

  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [clientId, record] of this.attempts.entries()) {
      // Remove expired block records
      if (record.blocked && record.blockedUntil && now > record.blockedUntil) {
        this.attempts.delete(clientId);
        cleaned++;
      }
      // Remove old window records that aren't blocked
      else if (!record.blocked && (now - record.windowStart) > this.windowMs * 2) {
        this.attempts.delete(clientId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Rate limit cleanup: removed ${cleaned} expired records`);
    }
  }

  getStats() {
    const stats = {
      totalTrackedIPs: this.attempts.size,
      blockedIPs: 0,
      activeAttempts: 0
    };

    for (const record of this.attempts.values()) {
      if (record.blocked) stats.blockedIPs++;
      if (record.attempts > 0) stats.activeAttempts++;
    }

    return stats;
  }
}

// Global rate limit store
const rateLimitStore = new RateLimitStore();

/**
 * Middleware factory for room access rate limiting
 */
function createRoomAccessRateLimit() {
  return (req, res, next) => {
    const clientId = rateLimitStore.getClientId(req);
    
    // SECURITY FIX: Allow authenticated users to bypass rate limiting
    const isAuthenticated = req.session?.user?.isAuthenticated || false;
    
    // Only apply rate limiting to unauthenticated users
    if (!isAuthenticated && rateLimitStore.isBlocked(clientId)) {
      const record = rateLimitStore.attempts.get(clientId);
      const timeLeft = Math.ceil((record.blockedUntil - Date.now()) / 1000 / 60); // minutes
      
      console.warn(`🛡️  Blocked brute force attempt from unauthenticated user ${clientId} (${timeLeft} minutes remaining)`);
      
      return res.status(429).json({
        error: 'Too many failed room access attempts. Please try again later.',
        retryAfter: timeLeft,
        type: 'rate_limit_exceeded'
      });
    }

    // Store original end method to intercept response
    const originalEnd = res.end;
    const originalJson = res.json;
    
    // Flag to ensure we only process once
    let processed = false;

    const processResponse = () => {
      if (processed) return;
      processed = true;

      // Only track failed attempts for unauthenticated users
      if (!isAuthenticated && res.statusCode === 404 && req.route && req.route.path === '/rooms/:roomId') {
        const result = rateLimitStore.recordFailedAttempt(clientId);
        console.log(`🔍 Failed room access attempt from unauthenticated user ${clientId}: ${result.attempts}/${result.maxAttempts}`);
        
        // Add rate limit headers for debugging
        res.set({
          'X-RateLimit-Attempts': result.attempts,
          'X-RateLimit-Max': result.maxAttempts,
          'X-RateLimit-Blocked': result.blocked
        });
      }
      // Record successful access (200 response) for any user
      else if (res.statusCode === 200 && req.route && req.route.path === '/rooms/:roomId') {
        rateLimitStore.recordSuccessfulAttempt(clientId);
      }
    };

    // Override response methods to track completion
    res.end = function(...args) {
      processResponse();
      originalEnd.apply(this, args);
    };

    res.json = function(...args) {
      processResponse();
      originalJson.apply(this, args);
    };

    next();
  };
}

/**
 * Middleware to get rate limit stats (for monitoring)
 */
function getRateLimitStats(req, res) {
  const stats = rateLimitStore.getStats();
  res.json({
    rateLimitStats: stats,
    configuration: {
      maxAttempts: rateLimitStore.maxAttempts,
      windowMinutes: rateLimitStore.windowMs / 1000 / 60,
      blockDurationMinutes: rateLimitStore.blockDurationMs / 1000 / 60
    }
  });
}

module.exports = {
  createRoomAccessRateLimit,
  getRateLimitStats,
  rateLimitStore // Export for testing
};