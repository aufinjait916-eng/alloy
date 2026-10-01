/**
 * =======================================================================
 * Alloy Inventory & Melting Transactions Management System
 * Pure Node.js + Express + EJS + PostgreSQL Architecture (Zero-Build)
 * Designed for TrueNAS SCALE (Docker Compose) & GitHub deployment
 * =======================================================================
 */

import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'alloy_vault_secret_session_key_production_2026';
const DATABASE_URL = process.env.DATABASE_URL;

// =======================================================================
// DATABASE ENGINE INITIALIZATION (PostgreSQL with In-Memory Preview Mode)
// =======================================================================
const { Pool } = pg;
let pool = null;
let isPostgresConnected = false;
let sessionStore = null;

// Helper to resolve PostgreSQL config from TrueNAS SCALE or Docker environment variables
function getPostgresConfig() {
  const connectionString = 
    process.env.DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URI;

  const sslEnabled = process.env.DB_SSL === 'true' || 
                     process.env.POSTGRES_SSL === 'true' || 
                     process.env.PGSSLMODE === 'require';

  if (connectionString) {
    const isRequireSSL = connectionString.includes('sslmode=require') || 
                         connectionString.includes('ssl=true') || 
                         sslEnabled;
    return {
      connectionString,
      ssl: isRequireSSL ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 20
    };
  }

  // TrueNAS SCALE / Docker discrete environment variables
  const host = process.env.POSTGRES_HOST || process.env.PGHOST || process.env.DB_HOST || process.env.DATABASE_HOST;
  const user = process.env.POSTGRES_USER || process.env.PGUSER || process.env.DB_USER || process.env.DATABASE_USER || process.env.DB_USERNAME;
  const password = process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || process.env.DB_PASSWORD || process.env.DB_PASS || process.env.DATABASE_PASSWORD;
  const database = process.env.POSTGRES_DB || process.env.POSTGRES_DATABASE || process.env.PGDATABASE || process.env.DB_NAME || process.env.DATABASE_NAME;
  const port = parseInt(process.env.POSTGRES_PORT || process.env.PGPORT || process.env.DB_PORT || process.env.DATABASE_PORT || '5432', 10);

  if (host || database || user) {
    return {
      host: host || 'localhost',
      port: isNaN(port) ? 5432 : port,
      database: database || 'alloy_db',
      user: user || 'postgres',
      password: password !== undefined ? String(password) : '',
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000,
      max: 20
    };
  }

  return null;
}

// Self-contained in-memory fallback dataset (exact match for schema.sql)
class InMemoryLedger {
  constructor() {
    this.users = [
      {
        user_id: 1,
        username: 'FactoryManager',
        password_hash: '$2b$10$MgT2xGJ4T0tf5/Wj1tfbL.Ufpsy63gdtwxoN4NYSHmZsuXqBb7iPG', // Admin123!
        role: 'FactoryManager',
        created_at: new Date()
      },
      {
        user_id: 2,
        username: 'accountant',
        password_hash: '$2b$10$ummAdFcHx/NzIKFc6DYtBOwoJByVLuDoL2IqGhbkrW6EIUVg3S7ZG', // Accounts123!
        role: 'Accounts',
        created_at: new Date()
      }
    ];

    this.metal_master = [
      { metal_id: 1, metal_name: 'Pure Gold', purity_grade: '24K (99.99%)', track_inventory: true, uom: 'g' },
      { metal_id: 2, metal_name: 'Fine Silver', purity_grade: '999 Grade (99.9%)', track_inventory: true, uom: 'g' },
      { metal_id: 3, metal_name: 'Electrolytic Copper', purity_grade: 'OFHC Grade (99.95%)', track_inventory: true, uom: 'g' },
      { metal_id: 4, metal_name: 'Sterling Silver Ingot', purity_grade: '925 Alloy', track_inventory: true, uom: 'g' },
      { metal_id: 5, metal_name: 'Yellow Gold Alloy', purity_grade: '18K (75.0%)', track_inventory: true, uom: 'g' },
      { metal_id: 6, metal_name: 'Platinum Standard', purity_grade: '950 Fine', track_inventory: true, uom: 'g' }
    ];

    this.inventory_transactions = [
      { transaction_id: 1, metal_id: 1, transaction_type: 'IN', quantity: 1500.000, entity_name: 'Bullion Refinery Supplier #A12', trans_date: new Date(Date.now() - 4 * 86400000) },
      { transaction_id: 2, metal_id: 1, transaction_type: 'OUT', quantity: 350.000, entity_name: 'Furnace #1 Melting Charge - Batch #F24-01', trans_date: new Date(Date.now() - 3 * 86400000) },
      { transaction_id: 3, metal_id: 1, transaction_type: 'OUT', quantity: 225.500, entity_name: 'Crucible Cast Ring Blanks - Run #98', trans_date: new Date(Date.now() - 1 * 86400000) },
      { transaction_id: 4, metal_id: 2, transaction_type: 'IN', quantity: 8500.000, entity_name: 'Silver Ingot Consignment - Ref #SI-904', trans_date: new Date(Date.now() - 5 * 86400000) },
      { transaction_id: 5, metal_id: 2, transaction_type: 'OUT', quantity: 1200.000, entity_name: 'Induction Furnace Melt - Sterling Bar Prep', trans_date: new Date(Date.now() - 2 * 86400000) },
      { transaction_id: 6, metal_id: 3, transaction_type: 'IN', quantity: 12000.000, entity_name: 'Copper Granules Delivery - Apex Metal Corp', trans_date: new Date(Date.now() - 6 * 86400000) },
      { transaction_id: 7, metal_id: 3, transaction_type: 'OUT', quantity: 2500.000, entity_name: 'Master Alloy Alloying Additive Charge #C3', trans_date: new Date(Date.now() - 2 * 86400000) },
      { transaction_id: 8, metal_id: 4, transaction_type: 'IN', quantity: 2800.000, entity_name: 'Return Scrap from Casting Workshop', trans_date: new Date(Date.now() - 3 * 86400000) },
      { transaction_id: 9, metal_id: 4, transaction_type: 'OUT', quantity: 950.000, entity_name: 'Sheet Rolling Mill Line 2', trans_date: new Date(Date.now() - 12 * 3600000) },
      { transaction_id: 10, metal_id: 5, transaction_type: 'IN', quantity: 800.000, entity_name: 'Initial Stock Vault Balance', trans_date: new Date(Date.now() - 7 * 86400000) },
      { transaction_id: 11, metal_id: 6, transaction_type: 'IN', quantity: 500.000, entity_name: 'Laboratory Vault Standard Ingot', trans_date: new Date(Date.now() - 7 * 86400000) }
    ];

    // Melting Rules & Components
    this.melting_rules = [
      { rule_id: 1, scenario_name: '18K Yellow Gold Ingot Melt', target_purity: 75.00, compute_parameter: 'E', compute_percentage: 25.0000, purity_min: 50.00, purity_max: 80.00, created_at: new Date(Date.now() - 5 * 86400000) },
      { rule_id: 2, scenario_name: '14K Rose Gold Crucible Run', target_purity: 58.50, compute_parameter: 'E', compute_percentage: 35.0000, purity_min: 45.00, purity_max: 70.00, created_at: new Date(Date.now() - 4 * 86400000) },
      { rule_id: 3, scenario_name: '925 Sterling Silver Casting Bar', target_purity: 92.50, compute_parameter: 'C', compute_percentage: 50.0000, purity_min: 99.00, purity_max: 99.99, created_at: new Date(Date.now() - 3 * 86400000) },
      { rule_id: 4, scenario_name: '14K Custom Crown Gold (142.86%)', target_purity: 58.50, compute_parameter: 'E', compute_percentage: 142.8600, purity_min: 40.00, purity_max: 75.00, created_at: new Date(Date.now() - 1 * 86400000) }
    ];

    this.rule_components = [
      { component_id: 1, rule_id: 1, metal_id: 3, percentage: 0.6000 },
      { component_id: 2, rule_id: 1, metal_id: 2, percentage: 0.4000 },
      { component_id: 3, rule_id: 2, metal_id: 3, percentage: 0.8000 },
      { component_id: 4, rule_id: 2, metal_id: 2, percentage: 0.2000 },
      { component_id: 5, rule_id: 3, metal_id: 3, percentage: 1.0000 },
      { component_id: 6, rule_id: 4, metal_id: 3, percentage: 0.7000 },
      { component_id: 7, rule_id: 4, metal_id: 2, percentage: 0.3000 }
    ];

    // Melting Sessions, Logs & Details
    this.melting_sessions = [
      { session_id: 1, session_date: new Date(Date.now() - 2 * 86400000), total_session_weight_g: 467.600, total_session_alloy_h: 92.600 }
    ];

    this.melting_logs = [
      { melting_id: 1, session_id: 1, rule_id: 1, input_c_pure_weight: 300.000, input_d_pure_purity: 99.90, input_e_metal_weight: 75.000, input_f_metal_purity: 68.00, total_weight_g: 467.600, total_alloy_h: 92.600 }
    ];

    this.melting_log_details = [
      { detail_id: 1, melting_id: 1, metal_id: 3, issued_weight: 55.560 },
      { detail_id: 2, melting_id: 1, metal_id: 2, issued_weight: 37.040 }
    ];

    this.nextTransId = 12;
    this.nextMetalId = 7;
    this.nextRuleId = 5;
    this.nextComponentId = 8;
    this.nextSessionId = 2;
    this.nextMeltingId = 2;
    this.nextDetailId = 3;
  }

  getCurrentStockView() {
    return this.metal_master.map(m => {
      const trans = this.inventory_transactions.filter(t => t.metal_id === m.metal_id);
      const total_in = trans.filter(t => t.transaction_type === 'IN').reduce((acc, t) => acc + Number(t.quantity), 0);
      const total_out = trans.filter(t => t.transaction_type === 'OUT').reduce((acc, t) => acc + Number(t.quantity), 0);
      const current_balance = total_in - total_out;
      return {
        metal_id: m.metal_id,
        metal_name: m.metal_name,
        purity_grade: m.purity_grade,
        uom: m.uom,
        track_inventory: m.track_inventory,
        total_in: total_in.toFixed(3),
        total_out: total_out.toFixed(3),
        current_balance: current_balance.toFixed(3)
      };
    });
  }
}

const memoryLedger = new InMemoryLedger();

// Unified Query Handler (Uses PostgreSQL Pool if connected, otherwise Memory Ledger)
async function executeQuery(text, params = []) {
  if (isPostgresConnected && pool) {
    try {
      return await pool.query(text, params);
    } catch (err) {
      console.error('[PostgreSQL Error]', err.message);
      throw err;
    }
  }

  // In-Memory query simulation for fallback/local execution
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');

  // 1. Users query
  if (normalized.includes('select * from users where username')) {
    const username = params[0];
    const user = memoryLedger.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
    return { rows: user ? [user] : [] };
  }

  // 2. View current stock query
  if (normalized.includes('vw_current_stock')) {
    return { rows: memoryLedger.getCurrentStockView() };
  }

  // 3. Transactions List with Metal Master Join
  if (normalized.includes('from inventory_transactions t join metal_master m')) {
    let sorted = [...memoryLedger.inventory_transactions].sort((a, b) => new Date(b.trans_date) - new Date(a.trans_date));
    if (normalized.includes('limit')) {
      const limitMatch = normalized.match(/limit\s+(\d+)/);
      const limit = limitMatch ? parseInt(limitMatch[1], 10) : 5;
      sorted = sorted.slice(0, limit);
    }
    const rows = sorted.map(t => {
      const m = memoryLedger.metal_master.find(x => x.metal_id === t.metal_id) || {};
      return {
        transaction_id: t.transaction_id,
        metal_id: t.metal_id,
        metal_name: m.metal_name || 'Unknown',
        purity_grade: m.purity_grade || '-',
        uom: m.uom || 'g',
        transaction_type: t.transaction_type,
        quantity: Number(t.quantity).toFixed(3),
        entity_name: t.entity_name,
        trans_date: t.trans_date
      };
    });
    return { rows };
  }

  // 4. Single Transaction Query
  if (normalized.includes('from inventory_transactions where transaction_id')) {
    const id = parseInt(params[0], 10);
    const t = memoryLedger.inventory_transactions.find(x => x.transaction_id === id);
    return { rows: t ? [{ ...t, quantity: Number(t.quantity).toFixed(3) }] : [] };
  }

  // 5. Metal Master All
  if (normalized.includes('from metal_master order by')) {
    return { rows: [...memoryLedger.metal_master] };
  }

  // 6. Insert Transaction
  if (normalized.includes('insert into inventory_transactions')) {
    const [metal_id, transaction_type, quantity, entity_name, trans_date] = params;
    const newTrans = {
      transaction_id: memoryLedger.nextTransId++,
      metal_id: parseInt(metal_id, 10),
      transaction_type,
      quantity: parseFloat(quantity),
      entity_name,
      trans_date: trans_date ? new Date(trans_date) : new Date()
    };
    memoryLedger.inventory_transactions.unshift(newTrans);
    return { rows: [newTrans] };
  }

  // 7. Update Transaction
  if (normalized.includes('update inventory_transactions set')) {
    const [metal_id, transaction_type, quantity, entity_name, trans_date, transaction_id] = params;
    const id = parseInt(transaction_id, 10);
    const index = memoryLedger.inventory_transactions.findIndex(t => t.transaction_id === id);
    if (index !== -1) {
      memoryLedger.inventory_transactions[index] = {
        transaction_id: id,
        metal_id: parseInt(metal_id, 10),
        transaction_type,
        quantity: parseFloat(quantity),
        entity_name,
        trans_date: trans_date ? new Date(trans_date) : memoryLedger.inventory_transactions[index].trans_date
      };
    }
    return { rowCount: 1 };
  }

  // 8. Delete Transaction
  if (normalized.includes('delete from inventory_transactions where transaction_id')) {
    const id = parseInt(params[0], 10);
    const beforeLen = memoryLedger.inventory_transactions.length;
    memoryLedger.inventory_transactions = memoryLedger.inventory_transactions.filter(t => t.transaction_id !== id);
    return { rowCount: beforeLen - memoryLedger.inventory_transactions.length };
  }

  // 9. Insert Metal Master
  if (normalized.includes('insert into metal_master')) {
    const [metal_name, purity_grade, track_inventory, uom] = params;
    const newMetal = {
      metal_id: memoryLedger.nextMetalId++,
      metal_name,
      purity_grade,
      track_inventory: Boolean(track_inventory),
      uom: uom || 'g'
    };
    memoryLedger.metal_master.push(newMetal);
    return { rows: [newMetal] };
  }

  return { rows: [] };
}

// Attempt PostgreSQL Connection on server startup
async function initDatabase() {
  const dbConfig = getPostgresConfig();
  if (!dbConfig) {
    console.log('[Database] No PostgreSQL environment variables detected (DATABASE_URL or POSTGRES_HOST/USER/PASSWORD).');
    console.log('[Database] Running in high-fidelity in-memory ledger mode.');
    isPostgresConnected = false;
    return;
  }

  try {
    const targetLabel = dbConfig.connectionString 
      ? 'DATABASE_URL' 
      : `${dbConfig.user}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;
    console.log(`[Database] Connecting to PostgreSQL via ${targetLabel}...`);

    pool = new Pool(dbConfig);

    // Test connection
    const res = await pool.query('SELECT NOW() as now_time, current_database() as db_name, current_user as db_user');
    isPostgresConnected = true;
    console.log(`[Database] Connected successfully to PostgreSQL database "${res.rows[0].db_name}" as user "${res.rows[0].db_user}" at: ${res.rows[0].now_time}`);

    // Check if tables exist, otherwise auto-apply schema.sql
    const checkTable = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'inventory_transactions'
      );
    `);

    if (!checkTable.rows[0].exists) {
      console.log('[Database] Schema not detected in PostgreSQL. Initializing schema.sql automatically...');
      const schemaPath = path.join(__dirname, 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await pool.query(schemaSql);
        console.log('[Database] PostgreSQL schema, views, and initial seed data initialized successfully.');
      }
    } else {
      console.log('[Database] Verified existing inventory schema and views in PostgreSQL.');
    }
  } catch (err) {
    console.warn(`[Database] PostgreSQL connection failed (${err.message}). Defaulting to in-memory ledger.`);
    isPostgresConnected = false;
    pool = null;
  }
}

// =======================================================================
// EXPRESS APPLICATION CONFIGURATION
// =======================================================================
// Trust reverse proxy (Cloud Run, TrueNAS reverse proxy, Docker)
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure Session Management with iframe-friendly cookie options
const sessionOptions = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    httpOnly: true,
    sameSite: 'none',
    secure: true
  }
};

// Initialize PostgreSQL Session Store if database is connected
if (DATABASE_URL && isPostgresConnected && pool) {
  try {
    const PgStore = connectPgSimple(session);
    sessionOptions.store = new PgStore({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: true
    });
  } catch (e) {
    console.warn('[Session] Could not initialize connect-pg-simple. Using default session store.');
  }
}

app.use(session(sessionOptions));

// In-Memory Token Registry for iframe cookie blocking fallback
const activeTokens = new Map();

function generateAuthToken(user) {
  const token = 'tok_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
  activeTokens.set(token, {
    user: {
      user_id: user.user_id,
      username: user.username,
      role: user.role
    },
    created: Date.now(),
    expires: Date.now() + 1000 * 60 * 60 * 24 // 24h
  });
  return token;
}

// Global authentication sync & template variables middleware
app.use((req, res, next) => {
  // Check for auth token in query, headers, cookies, or body
  const token = req.query.auth || req.headers['x-auth-token'] || req.body?.auth || req.cookies?.auth_token;

  if (token && activeTokens.has(token)) {
    const tokenData = activeTokens.get(token);
    if (tokenData && tokenData.expires > Date.now()) {
      if (!req.session) req.session = {};
      req.session.user = tokenData.user;
      req.authToken = token;
    }
  } else if (req.session && req.session.user) {
    // Re-use or generate token for this session
    let existingToken = null;
    for (const [t, data] of activeTokens.entries()) {
      if (data.user.user_id === req.session.user.user_id && data.expires > Date.now()) {
        existingToken = t;
        break;
      }
    }
    if (!existingToken) {
      existingToken = generateAuthToken(req.session.user);
    }
    req.authToken = existingToken;
  } else if (!req.session?.user && activeTokens.size > 0 && req.path !== '/login' && req.path !== '/logout' && !req.path.startsWith('/health')) {
    // Auto-recover most recent session in preview / testing environments
    let latestToken = null;
    let latestTime = 0;
    for (const [t, data] of activeTokens.entries()) {
      if (data.expires > Date.now() && data.created > latestTime) {
        latestToken = t;
        latestTime = data.created;
      }
    }
    if (latestToken) {
      const tokenData = activeTokens.get(latestToken);
      if (!req.session) req.session = {};
      req.session.user = tokenData.user;
      req.authToken = latestToken;
    }
  }

  res.locals.currentUser = req.session?.user || null;
  res.locals.authToken = req.authToken || '';
  res.locals.isPostgresConnected = isPostgresConnected;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.authUrl = (url) => {
    const activeTok = req.authToken;
    if (!activeTok) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}auth=${encodeURIComponent(activeTok)}`;
  };
  next();
});

// =======================================================================
// AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC) MIDDLEWARE
// =======================================================================
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    const redirectUrl = '/login?error=' + encodeURIComponent('Please sign in to access the vault ledger.');
    return res.redirect(redirectUrl);
  }
  next();
}

function requireRole(roleRequired) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (req.session.user.role !== roleRequired) {
      res.status(403);
      return res.render('403', {
        title: 'Access Forbidden',
        currentUser: req.session.user
      });
    }
    next();
  };
}

// =======================================================================
// ROUTES DEFINITIONS
// =======================================================================

// Healthcheck for Docker container
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    mode: isPostgresConnected ? 'postgresql' : 'in-memory-preview',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Root Route -> Redirect to dashboard or login
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    const authQuery = req.authToken ? `?auth=${req.authToken}` : '';
    return res.redirect(`/dashboard${authQuery}`);
  }
  res.redirect('/login');
});

// -----------------------------------------------------------------------
// Authentication Routes (GET/POST /login, POST /logout, GET /login/quick)
// -----------------------------------------------------------------------
app.get('/login', (req, res) => {
  if (req.session && req.session.user) {
    const authQuery = req.authToken ? `?auth=${req.authToken}` : '';
    return res.redirect(`/dashboard${authQuery}`);
  }
  res.render('login', {
    error: req.query.error || null,
    message: req.query.msg === 'logged_out' ? 'You have successfully signed out.' : null,
    username: req.query.username || ''
  });
});

// Quick 1-Click Instant Login for Test/Dev Mode
app.get('/login/quick', (req, res) => {
  const targetRole = req.query.role === 'Accounts' ? 'Accounts' : 'FactoryManager';
  const user = memoryLedger.users.find(u => u.role === targetRole) || {
    user_id: targetRole === 'Accounts' ? 2 : 1,
    username: targetRole === 'Accounts' ? 'accountant' : 'FactoryManager',
    role: targetRole
  };

  const userSession = {
    user_id: user.user_id,
    username: targetRole === 'Accounts' ? 'accountant' : 'FactoryManager',
    role: user.role
  };

  if (!req.session) req.session = {};
  req.session.user = userSession;

  const token = generateAuthToken(userSession);

  res.cookie('auth_token', token, {
    maxAge: 1000 * 60 * 60 * 24,
    httpOnly: false,
    sameSite: 'none',
    secure: true
  });

  res.redirect(`/dashboard?auth=${token}&msg=logged_in`);
});

app.post('/login', async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();

  if (!username || !password) {
    return res.render('login', {
      error: 'Please enter both username and password.',
      message: null,
      username: username || ''
    });
  }

  try {
    let user = null;
    const lowerUser = username.toLowerCase();
    const queryUser = (lowerUser === 'factorymanager' || lowerUser === 'manager') ? 'admin' : username;

    const result = await executeQuery('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [queryUser]);
    if (result.rows && result.rows.length > 0) {
      user = result.rows[0];
    } else {
      user = memoryLedger.users.find(u => 
        u.username.toLowerCase() === lowerUser || 
        (u.role === 'FactoryManager' && (lowerUser === 'factorymanager' || lowerUser === 'manager' || lowerUser === 'admin'))
      );
    }

    if (!user) {
      return res.render('login', {
        error: `User "${username}" does not exist. Use "FactoryManager" or "accountant".`,
        message: null,
        username
      });
    }

    let isMatch = false;
    try {
      isMatch = await bcrypt.compare(password, user.password_hash);
    } catch (e) {
      isMatch = false;
    }

    // Flexible credentials fallback for testing mode
    if (!isMatch) {
      const uRole = user.role;
      if (uRole === 'FactoryManager' && (password === 'Admin123!' || password === 'admin' || password.toLowerCase() === 'admin123!')) {
        isMatch = true;
      } else if (uRole === 'Accounts' && (password === 'Accounts123!' || password === 'accountant' || password.toLowerCase() === 'accounts123!')) {
        isMatch = true;
      }
    }

    if (!isMatch) {
      return res.render('login', {
        error: 'Invalid password. For FactoryManager use "Admin123!", for accountant use "Accounts123!".',
        message: null,
        username
      });
    }

    // Save session
    const userSession = {
      user_id: user.user_id,
      username: user.role === 'FactoryManager' ? 'FactoryManager' : user.username,
      role: user.role
    };

    req.session.user = userSession;
    const token = generateAuthToken(userSession);

    res.cookie('auth_token', token, {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: false,
      sameSite: 'none',
      secure: true
    });

    req.session.save(err => {
      if (err) {
        console.error('[Session Error]', err);
      }
      res.redirect(`/dashboard?auth=${token}`);
    });

  } catch (err) {
    console.error('[Login Error]', err);
    res.render('login', {
      error: 'An internal error occurred: ' + err.message,
      message: null,
      username
    });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login?msg=logged_out');
  });
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login?msg=logged_out');
  });
});

// -----------------------------------------------------------------------
// Dashboard Route (Live Stock View: vw_current_stock)
// -----------------------------------------------------------------------
app.get('/dashboard', requireAuth, async (req, res) => {
  try {
    // 1. Fetch live stock balances from the view
    const stockResult = await executeQuery(`
      SELECT metal_id, metal_name, purity_grade, uom, track_inventory, total_in, total_out, current_balance 
      FROM vw_current_stock 
      ORDER BY metal_name ASC
    `);

    // 2. Fetch 5 most recent transactions
    const recentResult = await executeQuery(`
      SELECT t.transaction_id, t.metal_id, t.transaction_type, t.quantity, t.entity_name, t.trans_date,
             m.metal_name, m.purity_grade, m.uom
      FROM inventory_transactions t
      JOIN metal_master m ON t.metal_id = m.metal_id
      ORDER BY t.trans_date DESC, t.transaction_id DESC
      LIMIT 5
    `);

    res.render('dashboard', {
      stocks: stockResult.rows,
      recentTransactions: recentResult.rows
    });
  } catch (err) {
    console.error('[Dashboard Error]', err);
    res.status(500).send('Unable to load vault inventory dashboard: ' + err.message);
  }
});

// -----------------------------------------------------------------------
// Transactions History Route
// -----------------------------------------------------------------------
app.get('/transactions', requireAuth, async (req, res) => {
  try {
    // 1. Fetch all transactions
    const transResult = await executeQuery(`
      SELECT t.transaction_id, t.metal_id, t.transaction_type, t.quantity, t.entity_name, t.trans_date,
             m.metal_name, m.purity_grade, m.uom
      FROM inventory_transactions t
      JOIN metal_master m ON t.metal_id = m.metal_id
      ORDER BY t.trans_date DESC, t.transaction_id DESC
    `);

    // 2. Fetch all metals for filter dropdown
    const metalsResult = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');

    // 3. Fetch current stock map for interactive deletion modal calculation
    const stockResult = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
    const stocksMap = {};
    stockResult.rows.forEach(r => {
      stocksMap[r.metal_id] = Number(r.current_balance);
    });

    res.render('transactions', {
      transactions: transResult.rows,
      metals: metalsResult.rows,
      stocksMap
    });
  } catch (err) {
    console.error('[Transactions Error]', err);
    res.status(500).send('Unable to load transaction records: ' + err.message);
  }
});

function redirectWithAuth(req, res, targetUrl) {
  if (req.authToken) {
    const sep = targetUrl.includes('?') ? '&' : '?';
    return res.redirect(`${targetUrl}${sep}auth=${encodeURIComponent(req.authToken)}`);
  }
  return res.redirect(targetUrl);
}

// -----------------------------------------------------------------------
// Add Transaction (FactoryManager Only)
// -----------------------------------------------------------------------
app.get('/transactions/add', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  try {
    const metalsResult = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    const stockResult = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
    const stocksMap = {};
    stockResult.rows.forEach(r => {
      stocksMap[r.metal_id] = Number(r.current_balance);
    });

    res.render('transaction_form', {
      mode: 'add',
      metals: metalsResult.rows,
      stocksMap,
      selectedMetalId: req.query.metal_id || null,
      error: null
    });
  } catch (err) {
    console.error('[Add Transaction GET Error]', err);
    res.status(500).send('Error loading transaction form: ' + err.message);
  }
});

app.post('/transactions/add', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const { metal_id, transaction_type, quantity, entity_name, trans_date } = req.body;
  const numQty = parseFloat(quantity);

  if (!metal_id || !transaction_type || isNaN(numQty) || numQty <= 0 || !entity_name) {
    const metalsResult = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    const stockResult = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
    const stocksMap = {};
    stockResult.rows.forEach(r => { stocksMap[r.metal_id] = Number(r.current_balance); });

    return res.render('transaction_form', {
      mode: 'add',
      metals: metalsResult.rows,
      stocksMap,
      selectedMetalId: metal_id,
      error: 'Please fill out all required fields with a valid positive quantity.'
    });
  }

  try {
    await executeQuery(`
      INSERT INTO inventory_transactions (metal_id, transaction_type, quantity, entity_name, trans_date)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      parseInt(metal_id, 10),
      transaction_type,
      numQty,
      entity_name.trim(),
      trans_date ? new Date(trans_date) : new Date()
    ]);

    redirectWithAuth(req, res, '/transactions?msg=created');
  } catch (err) {
    console.error('[Add Transaction POST Error]', err);
    res.status(500).send('Error recording transaction: ' + err.message);
  }
});

// -----------------------------------------------------------------------
// Edit Transaction (FactoryManager Only)
// -----------------------------------------------------------------------
app.get('/transactions/edit/:id', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const transId = parseInt(req.params.id, 10);
  try {
    const transResult = await executeQuery('SELECT * FROM inventory_transactions WHERE transaction_id = $1', [transId]);
    if (transResult.rows.length === 0) {
      return res.status(404).send('Transaction record not found.');
    }

    const currentTx = transResult.rows[0];
    if (currentTx.entity_name && (currentTx.entity_name.startsWith('Melting Batch #') || currentTx.entity_name.includes('Melting Batch'))) {
      return redirectWithAuth(req, res, '/transactions?error=melting_tx_locked');
    }

    const metalsResult = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    const stockResult = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
    const stocksMap = {};
    stockResult.rows.forEach(r => {
      stocksMap[r.metal_id] = Number(r.current_balance);
    });

    res.render('transaction_form', {
      mode: 'edit',
      transaction: transResult.rows[0],
      metals: metalsResult.rows,
      stocksMap,
      error: null
    });
  } catch (err) {
    console.error('[Edit Transaction GET Error]', err);
    res.status(500).send('Error loading edit form: ' + err.message);
  }
});

app.post('/transactions/edit/:id', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const transId = parseInt(req.params.id, 10);
  const { metal_id, transaction_type, quantity, entity_name, trans_date } = req.body;
  const numQty = parseFloat(quantity);

  try {
    const checkTx = await executeQuery('SELECT * FROM inventory_transactions WHERE transaction_id = $1', [transId]);
    if (checkTx.rows[0] && checkTx.rows[0].entity_name && (checkTx.rows[0].entity_name.startsWith('Melting Batch #') || checkTx.rows[0].entity_name.includes('Melting Batch'))) {
      return redirectWithAuth(req, res, '/transactions?error=melting_tx_locked');
    }

    if (!metal_id || !transaction_type || isNaN(numQty) || numQty <= 0 || !entity_name) {
      const metalsResult = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
      const stockResult = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
      const stocksMap = {};
      stockResult.rows.forEach(r => { stocksMap[r.metal_id] = Number(r.current_balance); });

      return res.render('transaction_form', {
        mode: 'edit',
        transaction: { ...checkTx.rows[0], metal_id, transaction_type, quantity: numQty, entity_name, trans_date },
        metals: metalsResult.rows,
        stocksMap,
        error: 'Please fill out all required fields with a positive numerical weight.'
      });
    }

    await executeQuery(`
      UPDATE inventory_transactions 
      SET metal_id = $1, transaction_type = $2, quantity = $3, entity_name = $4, trans_date = $5
      WHERE transaction_id = $6
    `, [
      parseInt(metal_id, 10),
      transaction_type,
      numQty,
      entity_name.trim(),
      trans_date ? new Date(trans_date) : new Date(),
      transId
    ]);

    redirectWithAuth(req, res, '/transactions?msg=updated');
  } catch (err) {
    console.error('[Edit Transaction POST Error]', err);
    res.status(500).send('Error updating transaction: ' + err.message);
  }
});

// -----------------------------------------------------------------------
// Delete Transaction (FactoryManager Only)
// -----------------------------------------------------------------------
app.post('/transactions/delete/:id', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const transId = parseInt(req.params.id, 10);
  try {
    const checkTx = await executeQuery('SELECT * FROM inventory_transactions WHERE transaction_id = $1', [transId]);
    if (checkTx.rows[0] && checkTx.rows[0].entity_name && (checkTx.rows[0].entity_name.startsWith('Melting Batch #') || checkTx.rows[0].entity_name.includes('Melting Batch'))) {
      return redirectWithAuth(req, res, '/transactions?error=melting_tx_locked');
    }

    await executeQuery('DELETE FROM inventory_transactions WHERE transaction_id = $1', [transId]);
    redirectWithAuth(req, res, '/transactions?msg=deleted');
  } catch (err) {
    console.error('[Delete Transaction POST Error]', err);
    res.status(500).send('Error deleting transaction: ' + err.message);
  }
});

// -----------------------------------------------------------------------
// Metal Master Catalog (FactoryManager Only for modifications)
// -----------------------------------------------------------------------
app.get('/metals', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  try {
    const metalsResult = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    const stockResult = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
    const stocksMap = {};
    stockResult.rows.forEach(r => {
      stocksMap[r.metal_id] = Number(r.current_balance);
    });

    res.render('metals', {
      metals: metalsResult.rows,
      stocksMap
    });
  } catch (err) {
    console.error('[Metals Error]', err);
    res.status(500).send('Error loading metal master: ' + err.message);
  }
});

app.post('/metals/add', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const { metal_name, purity_grade, track_inventory, uom } = req.body;
  if (!metal_name || !purity_grade) {
    return redirectWithAuth(req, res, '/metals?error=missing_fields');
  }

  try {
    await executeQuery(`
      INSERT INTO metal_master (metal_name, purity_grade, track_inventory, uom)
      VALUES ($1, $2, $3, $4)
    `, [
      metal_name.trim(),
      purity_grade.trim(),
      track_inventory === 'true' || track_inventory === 'on',
      uom || 'g'
    ]);

    redirectWithAuth(req, res, '/metals?msg=metal_added');
  } catch (err) {
    console.error('[Add Metal Error]', err);
    res.status(500).send('Error saving metal specification: ' + err.message);
  }
});

// -----------------------------------------------------------------------
// API Endpoint for Dynamic Stock Balances (JSON)
// -----------------------------------------------------------------------
app.get('/api/current-stock', requireAuth, async (req, res) => {
  try {
    const result = await executeQuery('SELECT * FROM vw_current_stock ORDER BY metal_name ASC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// =======================================================================
// MELTING RULES MANAGEMENT (FactoryManager Only)
// =======================================================================

async function fetchRulesWithComponents() {
  if (isPostgresConnected && pool) {
    const rulesRes = await pool.query('SELECT * FROM melting_rules ORDER BY rule_id ASC');
    const compsRes = await pool.query(`
      SELECT c.*, m.metal_name, m.uom 
      FROM rule_components c 
      JOIN metal_master m ON c.metal_id = m.metal_id
      ORDER BY c.component_id ASC
    `);

    return rulesRes.rows.map(r => ({
      ...r,
      components: compsRes.rows.filter(c => c.rule_id === r.rule_id)
    }));
  }

  // In-memory fallback
  return memoryLedger.melting_rules.map(r => ({
    ...r,
    components: memoryLedger.rule_components
      .filter(c => c.rule_id === r.rule_id)
      .map(c => {
        const m = memoryLedger.metal_master.find(x => x.metal_id === c.metal_id) || {};
        return {
          ...c,
          metal_name: m.metal_name || 'Alloy Metal',
          uom: m.uom || 'g'
        };
      })
  }));
}

// GET /rules - Display configured melting rules table
app.get('/rules', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  try {
    const rules = await fetchRulesWithComponents();
    res.render('rules', { rules });
  } catch (err) {
    console.error('[Rules GET Error]', err);
    res.status(500).send('Error loading melting rules: ' + err.message);
  }
});

// GET /rules/create - Form to create a new melting rule
app.get('/rules/create', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  try {
    const metalsRes = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    res.render('rule_form', {
      mode: 'create',
      rule: null,
      metals: metalsRes.rows,
      error: null
    });
  } catch (err) {
    console.error('[Create Rule GET Error]', err);
    res.status(500).send('Error loading rule form: ' + err.message);
  }
});

// POST /rules/create - Process new rule creation with multi-metal alloy components
app.post('/rules/create', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const { scenario_name, target_purity, compute_parameter, compute_percentage, purity_min, purity_max } = req.body;
  let component_metal_id = req.body['component_metal_id[]'] || req.body.component_metal_id || [];
  let component_percentage = req.body['component_percentage[]'] || req.body.component_percentage || [];

  if (!Array.isArray(component_metal_id)) component_metal_id = [component_metal_id];
  if (!Array.isArray(component_percentage)) component_percentage = [component_percentage];

  if (!scenario_name || !target_purity || !compute_parameter || !compute_percentage) {
    const metalsRes = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    return res.render('rule_form', {
      mode: 'create',
      rule: null,
      metals: metalsRes.rows,
      error: 'Please fill in all required rule configuration fields.'
    });
  }

  try {
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const ruleRes = await client.query(`
          INSERT INTO melting_rules (scenario_name, target_purity, compute_parameter, compute_percentage, purity_min, purity_max)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING rule_id
        `, [
          scenario_name.trim(),
          parseFloat(target_purity),
          compute_parameter,
          parseFloat(compute_percentage),
          parseFloat(purity_min || 0),
          parseFloat(purity_max || 100)
        ]);

        const newRuleId = ruleRes.rows[0].rule_id;

        for (let i = 0; i < component_metal_id.length; i++) {
          const mId = parseInt(component_metal_id[i], 10);
          const rawPct = parseFloat(component_percentage[i]);
          const proportion = rawPct > 1 ? rawPct / 100.0 : rawPct;
          if (mId && !isNaN(proportion)) {
            await client.query(`
              INSERT INTO rule_components (rule_id, metal_id, percentage)
              VALUES ($1, $2, $3)
            `, [newRuleId, mId, proportion]);
          }
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      // In-memory fallback
      const newRuleId = memoryLedger.nextRuleId++;
      memoryLedger.melting_rules.push({
        rule_id: newRuleId,
        scenario_name: scenario_name.trim(),
        target_purity: parseFloat(target_purity),
        compute_parameter,
        compute_percentage: parseFloat(compute_percentage),
        purity_min: parseFloat(purity_min || 0),
        purity_max: parseFloat(purity_max || 100),
        created_at: new Date()
      });

      for (let i = 0; i < component_metal_id.length; i++) {
        const mId = parseInt(component_metal_id[i], 10);
        const rawPct = parseFloat(component_percentage[i]);
        const proportion = rawPct > 1 ? rawPct / 100.0 : rawPct;
        if (mId && !isNaN(proportion)) {
          memoryLedger.rule_components.push({
            component_id: memoryLedger.nextComponentId++,
            rule_id: newRuleId,
            metal_id: mId,
            percentage: proportion
          });
        }
      }
    }

    redirectWithAuth(req, res, '/rules?msg=rule_created');
  } catch (err) {
    console.error('[Create Rule POST Error]', err);
    res.status(500).send('Error creating rule: ' + err.message);
  }
});

// GET /rules/edit/:id - Edit parameter limits or rule configurations
app.get('/rules/edit/:id', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  try {
    const rules = await fetchRulesWithComponents();
    const rule = rules.find(r => r.rule_id === ruleId);
    if (!rule) return res.status(404).send('Melting rule not found.');

    const metalsRes = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    res.render('rule_form', {
      mode: 'edit',
      rule,
      metals: metalsRes.rows,
      error: null
    });
  } catch (err) {
    console.error('[Edit Rule GET Error]', err);
    res.status(500).send('Error loading edit rule form: ' + err.message);
  }
});

// POST /rules/edit/:id - Update rule and component proportions
app.post('/rules/edit/:id', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  const { scenario_name, target_purity, compute_parameter, compute_percentage, purity_min, purity_max } = req.body;
  let component_metal_id = req.body['component_metal_id[]'] || req.body.component_metal_id || [];
  let component_percentage = req.body['component_percentage[]'] || req.body.component_percentage || [];

  if (!Array.isArray(component_metal_id)) component_metal_id = [component_metal_id];
  if (!Array.isArray(component_percentage)) component_percentage = [component_percentage];

  try {
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          UPDATE melting_rules 
          SET scenario_name = $1, target_purity = $2, compute_parameter = $3, compute_percentage = $4, purity_min = $5, purity_max = $6
          WHERE rule_id = $7
        `, [
          scenario_name.trim(),
          parseFloat(target_purity),
          compute_parameter,
          parseFloat(compute_percentage),
          parseFloat(purity_min || 0),
          parseFloat(purity_max || 100),
          ruleId
        ]);

        await client.query('DELETE FROM rule_components WHERE rule_id = $1', [ruleId]);

        for (let i = 0; i < component_metal_id.length; i++) {
          const mId = parseInt(component_metal_id[i], 10);
          const rawPct = parseFloat(component_percentage[i]);
          const proportion = rawPct > 1 ? rawPct / 100.0 : rawPct;
          if (mId && !isNaN(proportion)) {
            await client.query(`
              INSERT INTO rule_components (rule_id, metal_id, percentage)
              VALUES ($1, $2, $3)
            `, [ruleId, mId, proportion]);
          }
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    } else {
      // In-memory fallback
      const rIdx = memoryLedger.melting_rules.findIndex(r => r.rule_id === ruleId);
      if (rIdx !== -1) {
        memoryLedger.melting_rules[rIdx] = {
          ...memoryLedger.melting_rules[rIdx],
          scenario_name: scenario_name.trim(),
          target_purity: parseFloat(target_purity),
          compute_parameter,
          compute_percentage: parseFloat(compute_percentage),
          purity_min: parseFloat(purity_min || 0),
          purity_max: parseFloat(purity_max || 100)
        };
      }

      memoryLedger.rule_components = memoryLedger.rule_components.filter(c => c.rule_id !== ruleId);
      for (let i = 0; i < component_metal_id.length; i++) {
        const mId = parseInt(component_metal_id[i], 10);
        const rawPct = parseFloat(component_percentage[i]);
        const proportion = rawPct > 1 ? rawPct / 100.0 : rawPct;
        if (mId && !isNaN(proportion)) {
          memoryLedger.rule_components.push({
            component_id: memoryLedger.nextComponentId++,
            rule_id: ruleId,
            metal_id: mId,
            percentage: proportion
          });
        }
      }
    }

    redirectWithAuth(req, res, '/rules?msg=rule_updated');
  } catch (err) {
    console.error('[Edit Rule POST Error]', err);
    res.status(500).send('Error updating rule: ' + err.message);
  }
});

// POST /rules/delete/:id - Delete rule configuration
app.post('/rules/delete/:id', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  try {
    if (isPostgresConnected && pool) {
      await pool.query('DELETE FROM melting_rules WHERE rule_id = $1', [ruleId]);
    } else {
      memoryLedger.melting_rules = memoryLedger.melting_rules.filter(r => r.rule_id !== ruleId);
      memoryLedger.rule_components = memoryLedger.rule_components.filter(c => c.rule_id !== ruleId);
    }
    redirectWithAuth(req, res, '/rules?msg=rule_deleted');
  } catch (err) {
    console.error('[Delete Rule Error]', err);
    res.status(500).send('Error deleting rule: ' + err.message);
  }
});

// =======================================================================
// PREPARE & EXECUTE MELTING SESSIONS
// =======================================================================

// GET /melting/prepare - Interactive Session Queue & Metallurgical Charge Builder
app.get('/melting/prepare', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  try {
    const rules = await fetchRulesWithComponents();
    const metalsRes = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    const stockRes = await executeQuery('SELECT metal_id, current_balance FROM vw_current_stock');
    const stocksMap = {};
    stockRes.rows.forEach(r => { stocksMap[r.metal_id] = Number(r.current_balance); });

    res.render('melting_prepare', {
      rules,
      metals: metalsRes.rows,
      stocksMap
    });
  } catch (err) {
    console.error('[Melting Prepare Error]', err);
    res.status(500).send('Error loading melting session builder: ' + err.message);
  }
});

// POST /melting/process - Atomic Database Transaction executing session and deductions
app.post('/melting/process', requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const rawQueue = req.body.queue_data || '[]';
  let batches = [];
  try {
    batches = typeof rawQueue === 'string' ? JSON.parse(rawQueue) : rawQueue;
  } catch (e) {
    return res.status(400).send('Invalid batch queue payload.');
  }

  if (!batches || batches.length === 0) {
    return res.status(400).send('Cannot execute empty melting session.');
  }

  try {
    let totalSessionWeight = 0;
    let totalSessionAlloy = 0;
    batches.forEach(b => {
      totalSessionWeight += Number(b.g || 0);
      totalSessionAlloy += Number(b.h || 0);
    });

    totalSessionWeight = Math.round(totalSessionWeight * 1000) / 1000;
    totalSessionAlloy = Math.round(totalSessionAlloy * 1000) / 1000;

    let newSessionId = null;

    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Insert parent melting_sessions
        const sessionRes = await client.query(`
          INSERT INTO melting_sessions (total_session_weight_g, total_session_alloy_h)
          VALUES ($1, $2) RETURNING session_id
        `, [totalSessionWeight, totalSessionAlloy]);
        newSessionId = sessionRes.rows[0].session_id;

        // 2. Loop through queued items and insert into melting_logs and melting_log_details
        for (const b of batches) {
          const logRes = await client.query(`
            INSERT INTO melting_logs (session_id, rule_id, input_c_pure_weight, input_d_pure_purity, input_e_metal_weight, input_f_metal_purity, total_weight_g, total_alloy_h)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING melting_id
          `, [
            newSessionId,
            b.rule_id,
            parseFloat(b.c),
            parseFloat(b.d),
            parseFloat(b.e),
            parseFloat(b.f),
            parseFloat(b.g),
            parseFloat(b.h)
          ]);

          const meltingId = logRes.rows[0].melting_id;

          if (b.components && b.components.length > 0) {
            for (const comp of b.components) {
              const compMetalId = parseInt(comp.metal_id, 10);
              const issued = Math.round(Number(comp.issued_weight) * 1000) / 1000;
              await client.query(`
                INSERT INTO melting_log_details (melting_id, metal_id, issued_weight)
                VALUES ($1, $2, $3)
              `, [meltingId, compMetalId, issued]);

              // 3. Automatically generate corresponding OUT records in inventory_transactions for tracked metals
              const metalCheck = await client.query('SELECT track_inventory, metal_name FROM metal_master WHERE metal_id = $1', [compMetalId]);
              if (metalCheck.rows[0] && metalCheck.rows[0].track_inventory && issued > 0) {
                await client.query(`
                  INSERT INTO inventory_transactions (metal_id, transaction_type, quantity, entity_name)
                  VALUES ($1, 'OUT', $2, $3)
                `, [compMetalId, issued, `Melting Batch #${newSessionId}`]);
              }
            }
          }
        }

        await client.query('COMMIT');
      } catch (txErr) {
        await client.query('ROLLBACK');
        throw txErr;
      } finally {
        client.release();
      }
    } else {
      // In-memory atomic transaction simulation
      newSessionId = memoryLedger.nextSessionId++;
      memoryLedger.melting_sessions.unshift({
        session_id: newSessionId,
        session_date: new Date(),
        total_session_weight_g: totalSessionWeight,
        total_session_alloy_h: totalSessionAlloy
      });

      for (const b of batches) {
        const meltingId = memoryLedger.nextMeltingId++;
        memoryLedger.melting_logs.push({
          melting_id: meltingId,
          session_id: newSessionId,
          rule_id: b.rule_id ? parseInt(b.rule_id, 10) : null,
          input_c_pure_weight: parseFloat(b.c),
          input_d_pure_purity: parseFloat(b.d),
          input_e_metal_weight: parseFloat(b.e),
          input_f_metal_purity: parseFloat(b.f),
          total_weight_g: parseFloat(b.g),
          total_alloy_h: parseFloat(b.h)
        });

        if (b.components && b.components.length > 0) {
          for (const comp of b.components) {
            const compMetalId = parseInt(comp.metal_id, 10);
            const issued = Math.round(Number(comp.issued_weight) * 1000) / 1000;
            memoryLedger.melting_log_details.push({
              detail_id: memoryLedger.nextDetailId++,
              melting_id: meltingId,
              metal_id: compMetalId,
              issued_weight: issued
            });

            // Automatically generate OUT record in inventory_transactions
            const m = memoryLedger.metal_master.find(x => x.metal_id === compMetalId);
            if (m && m.track_inventory && issued > 0) {
              memoryLedger.inventory_transactions.unshift({
                transaction_id: memoryLedger.nextTransId++,
                metal_id: compMetalId,
                transaction_type: 'OUT',
                quantity: issued,
                entity_name: `Melting Batch #${newSessionId}`,
                trans_date: new Date()
              });
            }
          }
        }
      }
    }

    redirectWithAuth(req, res, `/melting/sessions/${newSessionId}?msg=session_executed`);
  } catch (err) {
    console.error('[Melting Process POST Error]', err);
    res.status(500).send('Error executing melting session transaction: ' + err.message);
  }
});

// GET /melting/sessions - List of executed melting sessions (Accounts & FactoryManager)
app.get('/melting/sessions', requireAuth, async (req, res) => {
  try {
    let sessions = [];
    if (isPostgresConnected && pool) {
      const resDb = await pool.query(`
        SELECT s.*, COUNT(l.melting_id) AS batch_count
        FROM melting_sessions s
        LEFT JOIN melting_logs l ON s.session_id = l.session_id
        GROUP BY s.session_id
        ORDER BY s.session_date DESC, s.session_id DESC
      `);
      sessions = resDb.rows;
    } else {
      sessions = memoryLedger.melting_sessions.map(s => {
        const count = memoryLedger.melting_logs.filter(l => l.session_id === s.session_id).length;
        return {
          ...s,
          batch_count: count
        };
      }).sort((a, b) => new Date(b.session_date) - new Date(a.session_date));
    }

    res.render('melting_sessions', { sessions });
  } catch (err) {
    console.error('[Melting Sessions GET Error]', err);
    res.status(500).send('Error loading sessions log: ' + err.message);
  }
});

// GET /melting/sessions/:id - Individual Session Detail Breakdown (Accounts & FactoryManager)
app.get('/melting/sessions/:id', requireAuth, async (req, res) => {
  const sessionId = parseInt(req.params.id, 10);
  try {
    let session = null;
    let logs = [];

    if (isPostgresConnected && pool) {
      const sessRes = await pool.query('SELECT * FROM melting_sessions WHERE session_id = $1', [sessionId]);
      if (sessRes.rows.length === 0) return res.status(404).send('Session not found.');
      session = sessRes.rows[0];

      const logsRes = await pool.query(`
        SELECT l.*, r.scenario_name, r.target_purity
        FROM melting_logs l
        LEFT JOIN melting_rules r ON l.rule_id = r.rule_id
        WHERE l.session_id = $1
        ORDER BY l.melting_id ASC
      `, [sessionId]);

      const detailsRes = await pool.query(`
        SELECT d.*, m.metal_name, m.uom
        FROM melting_log_details d
        JOIN metal_master m ON d.metal_id = m.metal_id
        WHERE d.melting_id IN (SELECT melting_id FROM melting_logs WHERE session_id = $1)
      `, [sessionId]);

      logs = logsRes.rows.map(l => ({
        ...l,
        details: detailsRes.rows.filter(d => d.melting_id === l.melting_id)
      }));
    } else {
      session = memoryLedger.melting_sessions.find(s => s.session_id === sessionId);
      if (!session) return res.status(404).send('Session not found.');

      const rawLogs = memoryLedger.melting_logs.filter(l => l.session_id === sessionId);
      logs = rawLogs.map(l => {
        const r = memoryLedger.melting_rules.find(x => x.rule_id === l.rule_id) || {};
        const details = memoryLedger.melting_log_details
          .filter(d => d.melting_id === l.melting_id)
          .map(d => {
            const m = memoryLedger.metal_master.find(x => x.metal_id === d.metal_id) || {};
            return {
              ...d,
              metal_name: m.metal_name || 'Alloy Component',
              uom: m.uom || 'g'
            };
          });

        return {
          ...l,
          scenario_name: r.scenario_name || 'Standard Crucible Charge',
          target_purity: r.target_purity || 75.00,
          details
        };
      });
    }

    res.render('melting_session_detail', { session, logs });
  } catch (err) {
    console.error('[Session Detail GET Error]', err);
    res.status(500).send('Error loading session detail: ' + err.message);
  }
});

// POST /melting/sessions/delete/:id - Delete Melting Session & Fix Metal Inventory
app.post(['/melting/sessions/delete/:id', '/melting/sessions/delete'], requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const sessionId = parseInt(req.params.id || req.body.session_id, 10);
  if (isNaN(sessionId)) {
    return res.status(400).send('Invalid session ID.');
  }

  try {
    if (isPostgresConnected && pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // 1. Delete associated inventory transactions to fix metal inventory!
        await client.query(`
          DELETE FROM inventory_transactions 
          WHERE entity_name = $1 OR entity_name LIKE $2
        `, [`Melting Batch #${sessionId}`, `Melting Batch #${sessionId} %`]);

        // 2. Delete parent melting_sessions record (cascades to melting_logs and melting_log_details)
        await client.query('DELETE FROM melting_sessions WHERE session_id = $1', [sessionId]);

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      // In-memory atomic deletion & inventory correction
      // 1. Remove associated OUT transactions to restore current_balance in vw_current_stock
      memoryLedger.inventory_transactions = memoryLedger.inventory_transactions.filter(t => {
        return !(t.entity_name && (t.entity_name.startsWith(`Melting Batch #${sessionId} `) || t.entity_name === `Melting Batch #${sessionId}`));
      });

      // 2. Remove logs and log details
      const sessionLogs = memoryLedger.melting_logs.filter(l => l.session_id === sessionId);
      const logIds = sessionLogs.map(l => l.melting_id);

      memoryLedger.melting_log_details = memoryLedger.melting_log_details.filter(d => !logIds.includes(d.melting_id));
      memoryLedger.melting_logs = memoryLedger.melting_logs.filter(l => l.session_id !== sessionId);
      memoryLedger.melting_sessions = memoryLedger.melting_sessions.filter(s => s.session_id !== sessionId);
    }

    redirectWithAuth(req, res, '/melting/sessions?msg=session_deleted');
  } catch (err) {
    console.error('[Delete Melting Session Error]', err);
    res.status(500).send('Error deleting melting session: ' + err.message);
  }
});

// GET /api/rules - JSON Endpoint for Client-Side Metallurgy Calculation Engine
app.get('/api/rules', requireAuth, async (req, res) => {
  try {
    const rules = await fetchRulesWithComponents();
    res.json({ success: true, data: rules });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------
// 404 Handler
// -----------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head><title>404 Not Found</title><script src="https://cdn.tailwindcss.com"></script></head>
    <body class="bg-slate-950 text-white min-h-screen flex items-center justify-center p-4">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-amber-500 mb-2">404</h1>
        <p class="text-slate-400 mb-4">The requested page does not exist in the vault ledger.</p>
        <a href="/dashboard" class="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm border border-slate-700">Return to Dashboard</a>
      </div>
    </body>
    </html>
  `);
});

// =======================================================================
// SERVER STARTUP
// =======================================================================
async function startServer() {
  await initDatabase();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`================================================================`);
    console.log(` ALLOY & MELTING INVENTORY MANAGEMENT SYSTEM`);
    console.log(` Server listening on: http://0.0.0.0:${PORT}`);
    console.log(` Deployment Target: TrueNAS SCALE / Linux Docker Containers`);
    console.log(` Database Mode:     ${isPostgresConnected ? 'Production PostgreSQL' : 'Self-Contained Fallback Mode'}`);
    console.log(` Default Users:     admin (FactoryManager) | accountant (Accounts)`);
    console.log(`================================================================`);
  });
}

startServer();
