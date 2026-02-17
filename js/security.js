/**
 * =====================================================
 * MilkFlow — Security Module
 * Password Hashing, Session Management, Rate Limiting,
 * Input Sanitization, and CSRF Protection
 * =====================================================
 */

const MilkSecurity = (() => {
    'use strict';

    // =============== PASSWORD HASHING (SHA-256 based) ===============
    // Uses SubtleCrypto API for secure hashing

    async function hashPassword(password, salt) {
        if (!salt) {
            salt = generateSalt();
        }
        const encoder = new TextEncoder();
        const data = encoder.encode(salt + password);

        // Use SHA-256 for hashing
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

        return { hash: hashHex, salt };
    }

    async function verifyPassword(password, storedHash, salt) {
        const { hash } = await hashPassword(password, salt);
        return hash === storedHash;
    }

    function generateSalt() {
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // =============== SECURE SESSION MANAGEMENT ===============
    const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes of inactivity
    const SESSION_KEY = 'mf_secure_session';
    let inactivityTimer = null;
    let sessionCheckInterval = null;

    function createSession(user) {
        const session = {
            username: user.username,
            role: user.role,
            name: user.name,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            token: generateSessionToken(),
            expiresAt: Date.now() + SESSION_TIMEOUT_MS,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        startInactivityMonitor();
        return session;
    }

    function getSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const session = JSON.parse(raw);

            // Check if session has expired
            if (Date.now() > session.expiresAt) {
                destroySession();
                return null;
            }

            return session;
        } catch {
            return null;
        }
    }

    function refreshSession() {
        const session = getSession();
        if (session) {
            session.lastActivity = Date.now();
            session.expiresAt = Date.now() + SESSION_TIMEOUT_MS;
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        }
        return session;
    }

    function destroySession() {
        localStorage.removeItem(SESSION_KEY);
        stopInactivityMonitor();
    }

    function generateSessionToken() {
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // =============== INACTIVITY MONITOR ===============
    let onSessionExpiredCallback = null;

    function startInactivityMonitor() {
        stopInactivityMonitor();

        // Listen for user activity
        const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];
        const handleActivity = throttle(() => {
            refreshSession();
        }, 5000); // Only refresh every 5 seconds to avoid excessive writes

        activityEvents.forEach(event => {
            document.addEventListener(event, handleActivity, { passive: true });
        });

        // Check session validity every minute
        sessionCheckInterval = setInterval(() => {
            const session = getSession();
            if (!session && onSessionExpiredCallback) {
                onSessionExpiredCallback();
            }
        }, 60000);

        // Store cleanup function
        window._milkSecurityCleanup = () => {
            activityEvents.forEach(event => {
                document.removeEventListener(event, handleActivity);
            });
        };
    }

    function stopInactivityMonitor() {
        if (sessionCheckInterval) {
            clearInterval(sessionCheckInterval);
            sessionCheckInterval = null;
        }
        if (window._milkSecurityCleanup) {
            window._milkSecurityCleanup();
            delete window._milkSecurityCleanup;
        }
    }

    function onSessionExpired(callback) {
        onSessionExpiredCallback = callback;
    }

    // =============== LOGIN RATE LIMITING ===============
    const MAX_LOGIN_ATTEMPTS = 5;
    const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes
    const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minute window
    const RATE_LIMIT_KEY = 'mf_login_attempts';

    function recordLoginAttempt(username, success) {
        const attempts = getLoginAttempts();
        attempts.push({
            username,
            timestamp: Date.now(),
            success,
        });

        // Keep only recent attempts
        const cutoff = Date.now() - ATTEMPT_WINDOW_MS;
        const filtered = attempts.filter(a => a.timestamp > cutoff);
        localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(filtered));
    }

    function getLoginAttempts() {
        try {
            return JSON.parse(localStorage.getItem(RATE_LIMIT_KEY)) || [];
        } catch {
            return [];
        }
    }

    function isLoginLocked() {
        const attempts = getLoginAttempts();
        const cutoff = Date.now() - LOCKOUT_DURATION_MS;
        const recentFailures = attempts.filter(a =>
            !a.success && a.timestamp > cutoff
        );

        if (recentFailures.length >= MAX_LOGIN_ATTEMPTS) {
            const oldestInWindow = Math.min(...recentFailures.map(a => a.timestamp));
            const unlockTime = oldestInWindow + LOCKOUT_DURATION_MS;
            const remainingMs = unlockTime - Date.now();
            const remainingMin = Math.ceil(remainingMs / 60000);
            return {
                locked: true,
                remainingMinutes: remainingMin,
                message: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin > 1 ? 's' : ''}.`,
            };
        }

        const remainingAttempts = MAX_LOGIN_ATTEMPTS - recentFailures.length;
        return {
            locked: false,
            remainingAttempts,
        };
    }

    // =============== INPUT SANITIZATION (XSS Prevention) ===============
    function sanitizeHTML(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sanitizeInput(input) {
        if (typeof input !== 'string') return '';
        // Remove any script tags and event handlers
        return input
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
            .replace(/javascript:/gi, '')
            .trim();
    }

    function validateUsername(username) {
        if (!username || username.length < 2 || username.length > 30) {
            return { valid: false, message: 'Username must be between 2 and 30 characters' };
        }
        if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
            return { valid: false, message: 'Username can only contain letters, numbers, dots, hyphens, and underscores' };
        }
        return { valid: true };
    }

    function validatePassword(password) {
        const issues = [];
        if (!password || password.length < 6) {
            issues.push('Must be at least 6 characters');
        }
        if (password && password.length > 128) {
            issues.push('Must be under 128 characters');
        }
        if (password && !/[a-z]/.test(password)) {
            issues.push('Must contain at least one lowercase letter');
        }
        if (password && !/[A-Z]/.test(password)) {
            issues.push('Must contain at least one uppercase letter');
        }
        if (password && !/[0-9]/.test(password)) {
            issues.push('Must contain at least one number');
        }

        return {
            valid: issues.length === 0,
            issues,
            strength: getPasswordStrength(password),
        };
    }

    function getPasswordStrength(password) {
        if (!password) return { level: 0, label: 'None', color: '#64748b' };

        let score = 0;
        if (password.length >= 6) score++;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;

        if (score <= 2) return { level: 1, label: 'Weak', color: '#ef4444' };
        if (score <= 4) return { level: 2, label: 'Fair', color: '#eab308' };
        if (score <= 5) return { level: 3, label: 'Good', color: '#22c55e' };
        return { level: 4, label: 'Strong', color: '#14b8a6' };
    }

    // =============== CSRF TOKEN ===============
    const CSRF_KEY = 'mf_csrf_token';

    function generateCSRFToken() {
        const token = generateSessionToken();
        sessionStorage.setItem(CSRF_KEY, token);
        return token;
    }

    function getCSRFToken() {
        return sessionStorage.getItem(CSRF_KEY);
    }

    function validateCSRFToken(token) {
        return token === getCSRFToken();
    }

    // =============== SECURE BACKUP ENCRYPTION ===============
    async function encryptBackupData(data, passphrase) {
        const encoder = new TextEncoder();
        const jsonStr = JSON.stringify(data);

        // Derive key from passphrase
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(passphrase),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(jsonStr)
        );

        return {
            encrypted: arrayBufferToBase64(encrypted),
            salt: arrayBufferToBase64(salt),
            iv: arrayBufferToBase64(iv),
            version: '2.0',
            isEncrypted: true,
        };
    }

    async function decryptBackupData(encryptedData, passphrase) {
        const encoder = new TextEncoder();

        const salt = base64ToArrayBuffer(encryptedData.salt);
        const iv = base64ToArrayBuffer(encryptedData.iv);
        const ciphertext = base64ToArrayBuffer(encryptedData.encrypted);

        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(passphrase),
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );

        const key = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256',
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            key,
            ciphertext
        );

        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(decrypted));
    }

    // =============== AUDIT LOG ===============
    const AUDIT_KEY = 'mf_audit_log';

    function auditLog(action, details, username) {
        try {
            const logs = JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
            logs.unshift({
                action,
                details,
                username: username || 'system',
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent.substring(0, 100),
            });
            // Keep last 200 audit entries
            if (logs.length > 200) logs.length = 200;
            localStorage.setItem(AUDIT_KEY, JSON.stringify(logs));
        } catch { /* ignore storage errors */ }
    }

    function getAuditLogs() {
        try {
            return JSON.parse(localStorage.getItem(AUDIT_KEY) || '[]');
        } catch {
            return [];
        }
    }

    // =============== UTILITY FUNCTIONS ===============
    function throttle(func, limit) {
        let inThrottle;
        return function (...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        bytes.forEach(b => binary += String.fromCharCode(b));
        return btoa(binary);
    }

    function base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // =============== PUBLIC API ===============
    return {
        // Password
        hashPassword,
        verifyPassword,
        generateSalt,
        validatePassword,
        getPasswordStrength,
        validateUsername,

        // Session
        createSession,
        getSession,
        refreshSession,
        destroySession,
        onSessionExpired,

        // Rate Limiting
        recordLoginAttempt,
        isLoginLocked,

        // Sanitization
        sanitizeHTML,
        sanitizeInput,

        // CSRF
        generateCSRFToken,
        getCSRFToken,
        validateCSRFToken,

        // Backup Encryption
        encryptBackupData,
        decryptBackupData,

        // Audit
        auditLog,
        getAuditLogs,
    };
})();
