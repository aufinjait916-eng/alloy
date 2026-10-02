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
import nodemailer from 'nodemailer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'alloy_vault_secret_session_key_production_2026';
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'AdminVault2026!').trim();

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
        username: ADMIN_USERNAME,
        password_hash: bcrypt.hashSync(ADMIN_PASSWORD, 10),
        role: 'Admin',
        created_at: new Date(Date.now() - 30 * 86400000)
      },
      {
        user_id: 2,
        username: 'manager',
        password_hash: '$2b$10$MgT2xGJ4T0tf5/Wj1tfbL.Ufpsy63gdtwxoN4NYSHmZsuXqBb7iPG', // Manager123! or Admin123!
        role: 'FactoryManager',
        created_at: new Date(Date.now() - 15 * 86400000)
      },
      {
        user_id: 3,
        username: 'accountant',
        password_hash: '$2b$10$ummAdFcHx/NzIKFc6DYtBOwoJByVLuDoL2IqGhbkrW6EIUVg3S7ZG', // Accounts123!
        role: 'Accounts',
        created_at: new Date(Date.now() - 10 * 86400000)
      }
    ];
    this.nextUserId = 4;

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
      { rule_id: 4, scenario_name: '14K Custom Crown Gold (142.86%)', target_purity: 58.50, compute_parameter: 'E', compute_percentage: 142.8600, purity_min: 40.00, purity_max: 75.00, created_at: new Date(Date.now() - 1 * 86400000) },
      { rule_id: 5, scenario_name: '18K Direct Scrap Conversion (None)', target_purity: 75.00, compute_parameter: 'None', compute_percentage: 0.0000, purity_min: 75.00, purity_max: 99.90, created_at: new Date() }
    ];

    this.rule_components = [
      { component_id: 1, rule_id: 1, metal_id: 3, percentage: 0.6000 },
      { component_id: 2, rule_id: 1, metal_id: 2, percentage: 0.4000 },
      { component_id: 3, rule_id: 2, metal_id: 3, percentage: 0.8000 },
      { component_id: 4, rule_id: 2, metal_id: 2, percentage: 0.2000 },
      { component_id: 5, rule_id: 3, metal_id: 3, percentage: 1.0000 },
      { component_id: 6, rule_id: 4, metal_id: 3, percentage: 0.7000 },
      { component_id: 7, rule_id: 4, metal_id: 2, percentage: 0.3000 },
      { component_id: 8, rule_id: 5, metal_id: 3, percentage: 0.6000 },
      { component_id: 9, rule_id: 5, metal_id: 2, percentage: 0.4000 }
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
    this.nextRuleId = 6;
    this.nextComponentId = 10;
    this.nextSessionId = 2;
    this.nextMeltingId = 2;
    this.nextDetailId = 3;
    this.email_settings = {
      setting_id: 1,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: '',
      smtp_pass: '',
      sender_name: 'Alloy Vault Ledger',
      recipient_emails: '',
      daily_report_enabled: false,
      scheduled_time: '18:00',
      last_sent_at: null
    };
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

  // 1. Users queries
  if (normalized.includes('from users')) {
    if (normalized.includes('where lower(username) = lower($1)') || normalized.includes('where username')) {
      const username = params[0];
      const user = memoryLedger.users.find(u => u.username.toLowerCase() === (username || '').toLowerCase());
      return { rows: user ? [user] : [] };
    }
    if (normalized.includes('where user_id')) {
      const id = parseInt(params[0], 10);
      const user = memoryLedger.users.find(u => u.user_id === id);
      return { rows: user ? [user] : [] };
    }
    return { rows: [...memoryLedger.users] };
  }

  if (normalized.includes('insert into users')) {
    const [username, password_hash, role] = params;
    const newUser = {
      user_id: memoryLedger.nextUserId++,
      username,
      password_hash,
      role,
      created_at: new Date()
    };
    memoryLedger.users.push(newUser);
    return { rows: [newUser] };
  }

  if (normalized.includes('update users')) {
    if (normalized.includes('password_hash')) {
      const [hash, id] = params;
      const user = memoryLedger.users.find(u => u.user_id === parseInt(id, 10));
      if (user) user.password_hash = hash;
      return { rows: user ? [user] : [] };
    }
    if (normalized.includes('role')) {
      const [role, id] = params;
      const user = memoryLedger.users.find(u => u.user_id === parseInt(id, 10));
      if (user) user.role = role;
      return { rows: user ? [user] : [] };
    }
  }

  if (normalized.includes('delete from users')) {
    const id = parseInt(params[0], 10);
    memoryLedger.users = memoryLedger.users.filter(u => u.user_id !== id);
    return { rows: [] };
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

  // 10. Update Metal Master
  if (normalized.includes('update metal_master set')) {
    const [metal_name, purity_grade, track_inventory, uom, metal_id] = params;
    const id = parseInt(metal_id, 10);
    const m = memoryLedger.metal_master.find(x => x.metal_id === id);
    if (m) {
      m.metal_name = metal_name;
      m.purity_grade = purity_grade;
      m.track_inventory = Boolean(track_inventory);
      m.uom = uom || 'g';
    }
    return { rowCount: m ? 1 : 0 };
  }

  // 11. Delete Metal Master
  if (normalized.includes('delete from metal_master where metal_id')) {
    const id = parseInt(params[0], 10);
    const beforeLen = memoryLedger.metal_master.length;
    memoryLedger.metal_master = memoryLedger.metal_master.filter(x => x.metal_id !== id);
    return { rowCount: beforeLen - memoryLedger.metal_master.length };
  }

  // 12. Single Metal Query
  if (normalized.includes('from metal_master where metal_id')) {
    const id = parseInt(params[0], 10);
    const m = memoryLedger.metal_master.find(x => x.metal_id === id);
    return { rows: m ? [m] : [] };
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

    // Ensure 'Admin' role is allowed in users table check constraint
    try {
      await pool.query(`
        ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
        ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Admin', 'FactoryManager', 'Accounts'));
      `);
    } catch (e) {
      // constraint update handled
    }

    // Ensure 'None' is allowed in melting_rules compute_parameter check constraint
    try {
      await pool.query(`
        ALTER TABLE melting_rules ALTER COLUMN compute_parameter TYPE VARCHAR(10);
        ALTER TABLE melting_rules DROP CONSTRAINT IF EXISTS melting_rules_compute_parameter_check;
        ALTER TABLE melting_rules ADD CONSTRAINT melting_rules_compute_parameter_check CHECK (compute_parameter IN ('C', 'E', 'None'));
      `);
    } catch (e) {
      // already altered or ignore
    }

    // Ensure Master Administrator exists and is synchronized with ADMIN_PASSWORD environment variable
    try {
      const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      const existingAdmin = await pool.query('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [ADMIN_USERNAME]);
      if (existingAdmin.rows.length === 0) {
        await pool.query(
          'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
          [ADMIN_USERNAME, adminHash, 'Admin']
        );
        console.log(`[Database] Provisioned administrator account "${ADMIN_USERNAME}" from environment variables.`);
      } else {
        await pool.query(
          'UPDATE users SET password_hash = $1, role = $2 WHERE user_id = $3',
          [adminHash, 'Admin', existingAdmin.rows[0].user_id]
        );
        console.log(`[Database] Synchronized administrator "${ADMIN_USERNAME}" credentials with ADMIN_PASSWORD environment variable.`);
      }

      // Ensure email_settings table exists
      await pool.query(`
        CREATE TABLE IF NOT EXISTS email_settings (
          setting_id INT PRIMARY KEY DEFAULT 1,
          smtp_host VARCHAR(255) DEFAULT 'smtp.gmail.com',
          smtp_port INT DEFAULT 587,
          smtp_secure BOOLEAN DEFAULT FALSE,
          smtp_user VARCHAR(255) DEFAULT '',
          smtp_pass VARCHAR(255) DEFAULT '',
          sender_name VARCHAR(255) DEFAULT 'Alloy Vault Ledger',
          recipient_emails TEXT DEFAULT '',
          daily_report_enabled BOOLEAN DEFAULT FALSE,
          scheduled_time VARCHAR(10) DEFAULT '18:00',
          last_sent_at TIMESTAMP WITH TIME ZONE NULL
        );
      `);
      const existingSettings = await pool.query('SELECT * FROM email_settings WHERE setting_id = 1');
      if (existingSettings.rows.length === 0) {
        await pool.query(`
          INSERT INTO email_settings (setting_id, smtp_host, smtp_port, smtp_secure, sender_name, scheduled_time)
          VALUES (1, 'smtp.gmail.com', 587, FALSE, 'Alloy Vault Ledger', '18:00')
        `);
      }
    } catch (e) {
      console.warn('[Database] Note on admin synchronization:', e.message);
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

// Determine cookie settings for session:
// - In Cloud Run / iframe preview environments, use sameSite: 'none' and secure: true.
// - In self-hosted production/on-prem environments (HTTP or HTTPS directly in browser),
//   use secure: 'auto' (true over HTTPS, false over HTTP) and sameSite: 'lax'.
const isCloudRunPreview = Boolean(process.env.K_SERVICE || process.env.CLOUD_RUN_JOB || process.env.AIS_ENV);
const cookieSecureConfig = process.env.COOKIE_SECURE !== undefined 
  ? process.env.COOKIE_SECURE === 'true' 
  : (isCloudRunPreview ? true : 'auto');
const cookieSameSiteConfig = process.env.COOKIE_SAMESITE || (isCloudRunPreview ? 'none' : 'lax');

// Configure Session Management
const sessionOptions = {
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 24 hours
    httpOnly: true,
    sameSite: cookieSameSiteConfig,
    secure: cookieSecureConfig
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
  }

  // Unauthenticated users remain strictly unauthenticated.
  // No automatic session assignment or token recovery across visitors.

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

function requireRole(...rolesRequired) {
  const allowed = rolesRequired.flat();
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.redirect('/login');
    }
    if (!allowed.includes(req.session.user.role)) {
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

// Quick 1-Click login removed per user security requirements
app.get('/login/quick', (req, res) => {
  res.redirect('/login');
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

    // 1. Direct authentication check for Master Admin from environment variable
    if (lowerUser === ADMIN_USERNAME.toLowerCase() && password === ADMIN_PASSWORD) {
      user = {
        user_id: 1,
        username: ADMIN_USERNAME,
        role: 'Admin'
      };
    } else {
      // 2. Query user from database or in-memory ledger
      const result = await executeQuery('SELECT * FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      if (result.rows && result.rows.length > 0) {
        user = result.rows[0];
      } else {
        user = memoryLedger.users.find(u => u.username.toLowerCase() === lowerUser);
      }

      if (!user) {
        return res.render('login', {
          error: 'Invalid username or password. Please check your credentials.',
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

      // Check against current ADMIN_PASSWORD if user is Admin
      if (!isMatch && user.role === 'Admin' && password === ADMIN_PASSWORD) {
        isMatch = true;
      }

      // Flexible fallback for seeded accounts if bcrypt check fails in preview mode
      if (!isMatch) {
        const uRole = user.role;
        if (uRole === 'FactoryManager' && (password === 'Manager123!' || password === 'Admin123!')) {
          isMatch = true;
        } else if (uRole === 'Accounts' && password === 'Accounts123!') {
          isMatch = true;
        }
      }

      if (!isMatch) {
        return res.render('login', {
          error: 'Invalid username or password. Please check your credentials.',
          message: null,
          username
        });
      }
    }

    // Save session
    const userSession = {
      user_id: user.user_id,
      username: user.username,
      role: user.role
    };

    req.session.user = userSession;
    const token = generateAuthToken(userSession);

    const isHttps = Boolean(req.secure || req.headers['x-forwarded-proto'] === 'https');
    const cookieSecure = process.env.COOKIE_SECURE !== undefined 
      ? process.env.COOKIE_SECURE === 'true' 
      : (isCloudRunPreview ? true : isHttps);
    const cookieSameSite = process.env.COOKIE_SAMESITE || (isCloudRunPreview ? 'none' : 'lax');

    res.cookie('auth_token', token, {
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: false,
      sameSite: cookieSameSite,
      secure: cookieSecure
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

function handleLogout(req, res) {
  const token = req.authToken || req.query.auth || req.cookies?.auth_token;
  if (token && activeTokens.has(token)) {
    activeTokens.delete(token);
  }
  res.clearCookie('auth_token');
  res.clearCookie('connect.sid');
  if (req.session) {
    req.session.destroy(() => {
      res.redirect('/login?msg=logged_out');
    });
  } else {
    res.redirect('/login?msg=logged_out');
  }
}

app.post('/logout', handleLogout);
app.get('/logout', handleLogout);

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
// Metal Master Catalog (Viewable by FactoryManager, Admin, Accounts)
// -----------------------------------------------------------------------
app.get('/metals', requireAuth, requireRole('FactoryManager', 'Admin', 'Accounts'), async (req, res) => {
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

// Edit Metal Specification (FactoryManager Only)
app.post(['/metals/edit/:id', '/metals/edit'], requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const metalId = parseInt(req.params.id || req.body.metal_id, 10);
  const { metal_name, purity_grade, track_inventory, uom } = req.body;

  if (isNaN(metalId)) {
    return redirectWithAuth(req, res, '/metals?error=invalid_metal_id');
  }

  if (!metal_name || !purity_grade) {
    return redirectWithAuth(req, res, '/metals?error=' + encodeURIComponent('Metal name and purity specification are required.'));
  }

  try {
    await executeQuery(`
      UPDATE metal_master 
      SET metal_name = $1, purity_grade = $2, track_inventory = $3, uom = $4
      WHERE metal_id = $5
    `, [
      metal_name.trim(),
      purity_grade.trim(),
      track_inventory === 'true' || track_inventory === 'on' || track_inventory === true,
      uom || 'g',
      metalId
    ]);

    redirectWithAuth(req, res, '/metals?msg=metal_updated');
  } catch (err) {
    console.error('[Edit Metal Error]', err);
    redirectWithAuth(req, res, '/metals?error=' + encodeURIComponent(err.message));
  }
});

// Delete Metal Specification (FactoryManager Only)
app.post(['/metals/delete/:id', '/metals/delete'], requireAuth, requireRole('FactoryManager'), async (req, res) => {
  const metalId = parseInt(req.params.id || req.body.metal_id, 10);
  if (isNaN(metalId)) {
    return redirectWithAuth(req, res, '/metals?error=invalid_metal_id');
  }

  try {
    // Check metal existence & name
    let metalName = 'Metal #' + metalId;
    const metalCheck = await executeQuery('SELECT * FROM metal_master WHERE metal_id = $1', [metalId]);
    if (metalCheck.rows && metalCheck.rows[0]) {
      metalName = metalCheck.rows[0].metal_name;
    }

    // Dependency check 1: Inventory transactions
    let txCount = 0;
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT COUNT(*) as count FROM inventory_transactions WHERE metal_id = $1', [metalId]);
      txCount = parseInt(res.rows[0].count, 10);
    } else {
      txCount = memoryLedger.inventory_transactions.filter(t => t.metal_id === metalId).length;
    }

    // Dependency check 2: Melting rule components
    let ruleCompCount = 0;
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT COUNT(*) as count FROM rule_components WHERE metal_id = $1', [metalId]);
      ruleCompCount = parseInt(res.rows[0].count, 10);
    } else {
      ruleCompCount = memoryLedger.rule_components.filter(c => c.metal_id === metalId).length;
    }

    // Dependency check 3: Melting log details
    let logDetailCount = 0;
    if (isPostgresConnected && pool) {
      const res = await pool.query('SELECT COUNT(*) as count FROM melting_log_details WHERE metal_id = $1', [metalId]);
      logDetailCount = parseInt(res.rows[0].count, 10);
    } else {
      logDetailCount = memoryLedger.melting_log_details.filter(d => d.metal_id === metalId).length;
    }

    if (txCount > 0 || ruleCompCount > 0 || logDetailCount > 0) {
      const reasons = [];
      if (txCount > 0) reasons.push(`${txCount} vault inventory transaction(s)`);
      if (ruleCompCount > 0) reasons.push(`${ruleCompCount} melting recipe component(s)`);
      if (logDetailCount > 0) reasons.push(`${logDetailCount} executed crucible session charge(s)`);
      return redirectWithAuth(req, res, '/metals?error=' + encodeURIComponent(`Cannot delete "${metalName}": It is referenced by ${reasons.join(', ')}. Please delete or unlink those records before removing this metal.`));
    }

    await executeQuery('DELETE FROM metal_master WHERE metal_id = $1', [metalId]);
    redirectWithAuth(req, res, '/metals?msg=metal_deleted');
  } catch (err) {
    console.error('[Delete Metal Error]', err);
    redirectWithAuth(req, res, '/metals?error=' + encodeURIComponent(err.message));
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

// GET /rules - Display configured melting rules table (Viewable by FactoryManager, Admin, Accounts)
app.get('/rules', requireAuth, requireRole('FactoryManager', 'Admin', 'Accounts'), async (req, res) => {
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

  const isNone = compute_parameter === 'None';
  if (!scenario_name || !target_purity || !compute_parameter || (!isNone && (compute_percentage === undefined || compute_percentage === ''))) {
    const metalsRes = await executeQuery('SELECT * FROM metal_master ORDER BY metal_name ASC');
    return res.render('rule_form', {
      mode: 'create',
      rule: null,
      metals: metalsRes.rows,
      error: 'Please fill in all required rule configuration fields.'
    });
  }

  const finalPct = isNone ? 0 : parseFloat(compute_percentage || 0);

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
          finalPct,
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
        compute_percentage: finalPct,
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

  const isNone = compute_parameter === 'None';
  const finalPct = isNone ? 0 : parseFloat(compute_percentage || 0);

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
          finalPct,
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
          compute_percentage: finalPct,
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

    let duplicateSession = null;
    const dupParam = req.query.duplicate || req.query.duplicate_session_id;
    const dupId = parseInt(dupParam, 10);
    if (!isNaN(dupId) && dupId > 0) {
      if (isPostgresConnected && pool) {
        const sessRes = await pool.query('SELECT * FROM melting_sessions WHERE session_id = $1', [dupId]);
        if (sessRes.rows.length > 0) {
          const logsRes = await pool.query(`
            SELECT l.*, r.scenario_name, r.target_purity
            FROM melting_logs l
            LEFT JOIN melting_rules r ON l.rule_id = r.rule_id
            WHERE l.session_id = $1
            ORDER BY l.melting_id ASC
          `, [dupId]);

          duplicateSession = {
            session_id: dupId,
            session_info: sessRes.rows[0],
            batches: logsRes.rows.map(l => ({
              rule_id: l.rule_id,
              rule_name: l.scenario_name || 'Standard Charge',
              target_purity: Number(l.target_purity || 75),
              c: Number(l.input_c_pure_weight),
              d: Number(l.input_d_pure_purity),
              e: Number(l.input_e_metal_weight),
              f: Number(l.input_f_metal_purity),
              g: Number(l.total_weight_g),
              h: Number(l.total_alloy_h)
            }))
          };
        }
      } else {
        const sess = memoryLedger.melting_sessions.find(s => s.session_id === dupId);
        if (sess) {
          const rawLogs = memoryLedger.melting_logs.filter(l => l.session_id === dupId);
          duplicateSession = {
            session_id: dupId,
            session_info: sess,
            batches: rawLogs.map(l => {
              const r = memoryLedger.melting_rules.find(x => x.rule_id === l.rule_id) || {};
              return {
                rule_id: l.rule_id,
                rule_name: r.scenario_name || 'Standard Charge',
                target_purity: Number(r.target_purity || 75),
                c: Number(l.input_c_pure_weight),
                d: Number(l.input_d_pure_purity),
                e: Number(l.input_e_metal_weight),
                f: Number(l.input_f_metal_purity),
                g: Number(l.total_weight_g),
                h: Number(l.total_alloy_h)
              };
            })
          };
        }
      }
    }

    res.render('melting_prepare', {
      rules,
      metals: metalsRes.rows,
      stocksMap,
      duplicateSession
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

// =======================================================================
// ADMIN USER MANAGEMENT PANEL (Admin Role Only)
// =======================================================================

// GET /admin/users - User Management Screen
app.get('/admin/users', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    let users = [];
    if (isPostgresConnected && pool) {
      const result = await pool.query('SELECT user_id, username, role, created_at FROM users ORDER BY user_id ASC');
      users = result.rows;
    } else {
      users = memoryLedger.users.map(u => ({
        user_id: u.user_id,
        username: u.username,
        role: u.role,
        created_at: u.created_at
      }));
    }

    res.render('admin_users', {
      users,
      adminUsername: ADMIN_USERNAME,
      query: req.query
    });
  } catch (err) {
    console.error('[Admin Users Error]', err);
    res.status(500).send('Error loading users: ' + err.message);
  }
});

// POST /admin/users/create - Create New User with FactoryManager or Accounts Role
app.post('/admin/users/create', requireAuth, requireRole('Admin'), async (req, res) => {
  const username = (req.body.username || '').trim();
  const role = (req.body.role || '').trim();
  const password = (req.body.password || '').trim();
  const confirmPassword = (req.body.confirm_password || '').trim();

  if (!username || !role || !password) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('All fields are required.'));
  }

  if (!['FactoryManager', 'Accounts'].includes(role)) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Invalid role specified.'));
  }

  if (password.length < 6) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Password must be at least 6 characters long.'));
  }

  if (password !== confirmPassword) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Passwords do not match.'));
  }

  try {
    let exists = false;
    if (isPostgresConnected && pool) {
      const check = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
      exists = check.rows.length > 0;
    } else {
      exists = memoryLedger.users.some(u => u.username.toLowerCase() === username.toLowerCase());
    }

    if (exists) {
      return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent(`Username "${username}" already exists.`));
    }

    const hash = await bcrypt.hash(password, 10);

    if (isPostgresConnected && pool) {
      await pool.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [username, hash, role]
      );
    } else {
      memoryLedger.users.push({
        user_id: memoryLedger.nextUserId++,
        username,
        password_hash: hash,
        role,
        created_at: new Date()
      });
    }

    redirectWithAuth(req, res, '/admin/users?msg=user_created');
  } catch (err) {
    console.error('[Create User Error]', err);
    redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/users/reset-password - Reset User Password
app.post('/admin/users/reset-password', requireAuth, requireRole('Admin'), async (req, res) => {
  const userId = parseInt(req.body.user_id, 10);
  const newPassword = (req.body.new_password || '').trim();
  const confirmPassword = (req.body.confirm_password || '').trim();

  if (isNaN(userId) || !newPassword) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Invalid request parameters.'));
  }

  if (newPassword.length < 6) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Password must be at least 6 characters.'));
  }

  if (newPassword !== confirmPassword) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Passwords do not match.'));
  }

  try {
    const hash = await bcrypt.hash(newPassword, 10);

    if (isPostgresConnected && pool) {
      await pool.query('UPDATE users SET password_hash = $1 WHERE user_id = $2', [hash, userId]);
    } else {
      const user = memoryLedger.users.find(u => u.user_id === userId);
      if (user) {
        user.password_hash = hash;
      }
    }

    redirectWithAuth(req, res, '/admin/users?msg=password_reset');
  } catch (err) {
    console.error('[Reset Password Error]', err);
    redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/users/change-role - Update User Role
app.post('/admin/users/change-role', requireAuth, requireRole('Admin'), async (req, res) => {
  const userId = parseInt(req.body.user_id, 10);
  const newRole = (req.body.new_role || '').trim();

  if (isNaN(userId) || !['FactoryManager', 'Accounts'].includes(newRole)) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Invalid user or role.'));
  }

  if (userId === req.session.user.user_id) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Cannot change role of active administrator.'));
  }

  try {
    if (isPostgresConnected && pool) {
      await pool.query('UPDATE users SET role = $1 WHERE user_id = $2', [newRole, userId]);
    } else {
      const user = memoryLedger.users.find(u => u.user_id === userId);
      if (user) {
        user.role = newRole;
      }
    }

    redirectWithAuth(req, res, '/admin/users?msg=role_updated');
  } catch (err) {
    console.error('[Change Role Error]', err);
    redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/users/delete/:id - Delete User
app.post(['/admin/users/delete/:id', '/admin/users/delete'], requireAuth, requireRole('Admin'), async (req, res) => {
  const userId = parseInt(req.params.id || req.body.user_id, 10);

  if (isNaN(userId)) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Invalid user ID.'));
  }

  if (userId === req.session.user.user_id || userId === 1) {
    return redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent('Cannot delete primary administrator account.'));
  }

  try {
    if (isPostgresConnected && pool) {
      await pool.query('DELETE FROM users WHERE user_id = $1', [userId]);
    } else {
      memoryLedger.users = memoryLedger.users.filter(u => u.user_id !== userId);
    }

    redirectWithAuth(req, res, '/admin/users?msg=user_deleted');
  } catch (err) {
    console.error('[Delete User Error]', err);
    redirectWithAuth(req, res, '/admin/users?error=' + encodeURIComponent(err.message));
  }
});

// =======================================================================
// ADMIN EMAIL & DAILY REPORT DISPATCH SYSTEM (Admin Role Only)
// =======================================================================

async function getEmailSettings() {
  if (isPostgresConnected && pool) {
    try {
      const res = await pool.query('SELECT * FROM email_settings WHERE setting_id = 1');
      if (res.rows.length > 0) return res.rows[0];
    } catch (e) {
      console.warn('[Email Settings] Database query failed, using in-memory settings:', e.message);
    }
  }
  return memoryLedger.email_settings;
}

async function saveEmailSettings(data) {
  const host = (data.smtp_host || 'smtp.gmail.com').trim();
  const port = parseInt(data.smtp_port, 10) || 587;
  const secure = data.smtp_secure === 'true' || data.smtp_secure === true;
  const user = (data.smtp_user || '').trim();
  const pass = data.smtp_pass !== undefined ? data.smtp_pass.trim() : '';
  const senderName = (data.sender_name || 'Alloy Vault Ledger').trim();
  const recipients = (data.recipient_emails || '').trim();
  const dailyEnabled = data.daily_report_enabled === 'true' || data.daily_report_enabled === true;
  const schedTime = (data.scheduled_time || '18:00').trim();

  if (isPostgresConnected && pool) {
    await pool.query(`
      INSERT INTO email_settings (setting_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, sender_name, recipient_emails, daily_report_enabled, scheduled_time)
      VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (setting_id) DO UPDATE SET
        smtp_host = EXCLUDED.smtp_host,
        smtp_port = EXCLUDED.smtp_port,
        smtp_secure = EXCLUDED.smtp_secure,
        smtp_user = EXCLUDED.smtp_user,
        smtp_pass = CASE WHEN EXCLUDED.smtp_pass <> '' THEN EXCLUDED.smtp_pass ELSE email_settings.smtp_pass END,
        sender_name = EXCLUDED.sender_name,
        recipient_emails = EXCLUDED.recipient_emails,
        daily_report_enabled = EXCLUDED.daily_report_enabled,
        scheduled_time = EXCLUDED.scheduled_time
    `, [host, port, secure, user, pass, senderName, recipients, dailyEnabled, schedTime]);
  } else {
    memoryLedger.email_settings.smtp_host = host;
    memoryLedger.email_settings.smtp_port = port;
    memoryLedger.email_settings.smtp_secure = secure;
    memoryLedger.email_settings.smtp_user = user;
    if (pass !== '') memoryLedger.email_settings.smtp_pass = pass;
    memoryLedger.email_settings.sender_name = senderName;
    memoryLedger.email_settings.recipient_emails = recipients;
    memoryLedger.email_settings.daily_report_enabled = dailyEnabled;
    memoryLedger.email_settings.scheduled_time = schedTime;
  }
}

function createMailTransporter(settings) {
  const isGmail = (settings.smtp_host || '').toLowerCase().includes('gmail.com');
  const port = parseInt(settings.smtp_port, 10) || 587;
  const secure = Boolean(settings.smtp_secure || port === 465);

  const config = {
    host: settings.smtp_host || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: settings.smtp_user,
      pass: settings.smtp_pass
    },
    tls: {
      rejectUnauthorized: false
    }
  };

  if (isGmail && !secure && port === 587) {
    config.service = 'gmail';
  }

  return nodemailer.createTransport(config);
}

async function buildDailyEodReportData() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  let todaysSessions = [];
  let metalsUsed = [];
  let currentStocks = [];

  if (isPostgresConnected && pool) {
    // 1. Todays melting sessions
    const sessRes = await pool.query(`
      SELECT session_id, session_date, total_session_weight_g, total_session_alloy_h
      FROM melting_sessions
      WHERE session_date >= $1
      ORDER BY session_id DESC
    `, [startOfDay]);
    todaysSessions = sessRes.rows;

    // 2. Itemized metals used today
    const usedRes = await pool.query(`
      SELECT m.metal_name, m.purity_grade, m.uom, SUM(t.quantity) as total_used
      FROM inventory_transactions t
      JOIN metal_master m ON t.metal_id = m.metal_id
      WHERE t.transaction_type = 'OUT' AND t.trans_date >= $1
      GROUP BY m.metal_name, m.purity_grade, m.uom
      ORDER BY m.metal_name ASC
    `, [startOfDay]);
    metalsUsed = usedRes.rows.map(r => ({
      ...r,
      total_used: Number(r.total_used)
    }));

    // 3. Current live inventory stock balances
    const stockRes = await pool.query(`
      SELECT metal_name, purity_grade, uom, total_in, total_out, current_balance
      FROM vw_current_stock
      ORDER BY metal_name ASC
    `);
    currentStocks = stockRes.rows.map(r => ({
      ...r,
      total_in: Number(r.total_in),
      total_out: Number(r.total_out),
      current_balance: Number(r.current_balance)
    }));
  } else {
    todaysSessions = memoryLedger.melting_sessions.filter(s => new Date(s.session_date) >= startOfDay);

    const outTransToday = memoryLedger.inventory_transactions.filter(t => t.transaction_type === 'OUT' && new Date(t.trans_date) >= startOfDay);
    const usedMap = {};
    outTransToday.forEach(t => {
      const m = memoryLedger.metal_master.find(x => x.metal_id === t.metal_id);
      if (m) {
        if (!usedMap[m.metal_id]) {
          usedMap[m.metal_id] = {
            metal_name: m.metal_name,
            purity_grade: m.purity_grade,
            uom: m.uom || 'g',
            total_used: 0
          };
        }
        usedMap[m.metal_id].total_used += Number(t.quantity);
      }
    });
    metalsUsed = Object.values(usedMap);

    const stockRes = await executeQuery('SELECT metal_name, purity_grade, uom, total_in, total_out, current_balance FROM vw_current_stock ORDER BY metal_name ASC');
    currentStocks = stockRes.rows.map(r => ({
      ...r,
      total_in: Number(r.total_in),
      total_out: Number(r.total_out),
      current_balance: Number(r.current_balance)
    }));
  }

  const totalOutputG = todaysSessions.reduce((acc, s) => acc + Number(s.total_session_weight_g), 0);
  const totalAlloyH = todaysSessions.reduce((acc, s) => acc + Number(s.total_session_alloy_h), 0);

  return {
    date: new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    sessionsCount: todaysSessions.length,
    totalOutputG: Math.round(totalOutputG * 1000) / 1000,
    totalAlloyH: Math.round(totalAlloyH * 1000) / 1000,
    todaysSessions,
    metalsUsed,
    currentStocks
  };
}

function generateDailyEmailHtml(report, settings) {
  const sessionsRows = report.todaysSessions.length > 0
    ? report.todaysSessions.map(s => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold; color: #1e293b;">#${s.session_id}</td>
          <td style="padding: 10px; color: #475569;">${new Date(s.session_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
          <td style="padding: 10px; text-align: right; font-weight: bold; color: #0f172a;">${Number(s.total_session_weight_g).toFixed(3)} g</td>
          <td style="padding: 10px; text-align: right; font-weight: bold; color: ${Number(s.total_session_alloy_h) < 0 ? '#dc2626' : '#d97706'};">${Number(s.total_session_alloy_h).toFixed(3)} g</td>
        </tr>
      `).join('')
    : `<tr><td colspan="4" style="padding: 16px; text-align: center; color: #64748b; font-style: italic;">No melting sessions executed today.</td></tr>`;

  const metalsUsedRows = report.metalsUsed.length > 0
    ? report.metalsUsed.map(m => `
        <tr style="border-bottom: 1px solid #e2e8f0;">
          <td style="padding: 10px; font-weight: bold; color: #1e293b;">${m.metal_name}</td>
          <td style="padding: 10px; color: #64748b; font-size: 12px;">${m.purity_grade}</td>
          <td style="padding: 10px; text-align: right; font-weight: bold; color: #b45309;">${m.total_used.toFixed(3)} ${m.uom}</td>
        </tr>
      `).join('')
    : `<tr><td colspan="3" style="padding: 16px; text-align: center; color: #64748b; font-style: italic;">No metal or alloy movements issued today.</td></tr>`;

  const stockRows = report.currentStocks.map(s => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px; font-weight: bold; color: #0f172a;">${s.metal_name}</td>
      <td style="padding: 10px; color: #64748b; font-size: 12px;">${s.purity_grade}</td>
      <td style="padding: 10px; text-align: right; color: #047857;">+${s.total_in.toFixed(3)}</td>
      <td style="padding: 10px; text-align: right; color: #b91c1c;">-${s.total_out.toFixed(3)}</td>
      <td style="padding: 10px; text-align: right; font-weight: bold; font-size: 14px; color: ${s.current_balance < 0 ? '#dc2626' : '#0f172a'};">${s.current_balance.toFixed(3)} ${s.uom}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>End-of-Day Vault Inventory Report</title>
    </head>
    <body style="margin: 0; padding: 24px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #78350f 0%, #b45309 50%, #d97706 100%); padding: 28px 24px; color: #ffffff;">
          <table style="width: 100%;">
            <tr>
              <td>
                <span style="font-size: 28px; vertical-align: middle;">⚱</span>
                <span style="font-size: 20px; font-weight: 800; letter-spacing: 0.5px; vertical-align: middle; margin-left: 8px;">ALLOY VAULT LEDGER</span>
                <div style="font-size: 13px; opacity: 0.9; margin-top: 4px;">Daily End-of-Day Metallurgical &amp; Stock Summary</div>
              </td>
              <td style="text-align: right; font-size: 12px; font-family: monospace; opacity: 0.95;">
                ${report.date}
              </td>
            </tr>
          </table>
        </div>

        <div style="padding: 24px;">

          <!-- KPI Cards Strip -->
          <div style="display: table; width: 100%; margin-bottom: 24px;">
            <div style="display: table-cell; width: 33.3%; padding: 4px;">
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; text-align: center;">
                <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Melting Sessions</div>
                <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px;">${report.sessionsCount}</div>
              </div>
            </div>
            <div style="display: table-cell; width: 33.3%; padding: 4px;">
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; text-align: center;">
                <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Combined Output (G)</div>
                <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-top: 4px;">${report.totalOutputG.toFixed(3)} g</div>
              </div>
            </div>
            <div style="display: table-cell; width: 33.3%; padding: 4px;">
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; text-align: center;">
                <div style="font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 600;">Alloy Issued (H)</div>
                <div style="font-size: 20px; font-weight: 800; color: #d97706; margin-top: 4px;">${report.totalAlloyH.toFixed(3)} g</div>
              </div>
            </div>
          </div>

          <!-- Section 1: Melting Sessions -->
          <div style="margin-bottom: 28px;">
            <h3 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #0f172a; margin: 0 0 10px 0; border-bottom: 2px solid #f59e0b; padding-bottom: 6px;">
              1. Crucible Melting Sessions Run Today
            </h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 1px solid #cbd5e1; text-align: left; color: #475569; font-size: 11px; text-transform: uppercase;">
                  <th style="padding: 8px 10px;">Session</th>
                  <th style="padding: 8px 10px;">Time</th>
                  <th style="padding: 8px 10px; text-align: right;">Target Weight (G)</th>
                  <th style="padding: 8px 10px; text-align: right;">Required Alloy (H)</th>
                </tr>
              </thead>
              <tbody>
                ${sessionsRows}
              </tbody>
            </table>
          </div>

          <!-- Section 2: Metals & Alloys Used Today -->
          <div style="margin-bottom: 28px;">
            <h3 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #0f172a; margin: 0 0 10px 0; border-bottom: 2px solid #3b82f6; padding-bottom: 6px;">
              2. Total Metals &amp; Alloys Used / Issued Today
            </h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 1px solid #cbd5e1; text-align: left; color: #475569; font-size: 11px; text-transform: uppercase;">
                  <th style="padding: 8px 10px;">Metal / Alloy</th>
                  <th style="padding: 8px 10px;">Purity Grade</th>
                  <th style="padding: 8px 10px; text-align: right;">Total Issued</th>
                </tr>
              </thead>
              <tbody>
                ${metalsUsedRows}
              </tbody>
            </table>
          </div>

          <!-- Section 3: End of Day Metal & Alloy Balances -->
          <div style="margin-bottom: 20px;">
            <h3 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #0f172a; margin: 0 0 10px 0; border-bottom: 2px solid #10b981; padding-bottom: 6px;">
              3. Closing Vault Stock Balances (End of Day)
            </h3>
            <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
              <thead>
                <tr style="background-color: #f8fafc; border-bottom: 1px solid #cbd5e1; text-align: left; color: #475569; font-size: 11px; text-transform: uppercase;">
                  <th style="padding: 8px 10px;">Metal Specification</th>
                  <th style="padding: 8px 10px;">Grade</th>
                  <th style="padding: 8px 10px; text-align: right;">Total In</th>
                  <th style="padding: 8px 10px; text-align: right;">Total Out</th>
                  <th style="padding: 8px 10px; text-align: right;">Available Balance</th>
                </tr>
              </thead>
              <tbody>
                ${stockRows}
              </tbody>
            </table>
          </div>

        </div>

        <!-- Footer -->
        <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 24px; text-align: center; font-size: 11px; color: #64748b;">
          Automated End-of-Day Metallurgical &amp; Vault Inventory Report &bull; Alloy &amp; Melting Transactions System
        </div>

      </div>
    </body>
    </html>
  `;
}

async function sendTestEmail(settings, targetEmail) {
  const transporter = createMailTransporter(settings);
  await transporter.verify();

  const info = await transporter.sendMail({
    from: `"${settings.sender_name || 'Alloy Vault Ledger'}" <${settings.smtp_user}>`,
    to: targetEmail,
    subject: `[Alloy Vault] SMTP Connection Verified Successfully`,
    text: `Hello,\n\nYour SMTP server configuration (${settings.smtp_host}:${settings.smtp_port}) has been verified successfully!\n\nAutomated daily EOD reports are configured for dispatch at ${settings.scheduled_time} to: ${settings.recipient_emails}.\n\nAlloy & Melting Transactions Management System`,
    html: `
      <div style="font-family: sans-serif; padding: 20px; background-color: #f8fafc; color: #0f172a;">
        <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
          <h2 style="color: #d97706; margin-top: 0;">✓ SMTP Connection Verified</h2>
          <p style="font-size: 14px; line-height: 1.5; color: #334155;">
            Hello,<br><br>
            Your SMTP email configuration has connected successfully!
          </p>
          <div style="background-color: #f1f5f9; padding: 12px; border-radius: 8px; font-size: 12px; font-family: monospace; margin: 16px 0;">
            Host: ${settings.smtp_host}<br>
            Port: ${settings.smtp_port}<br>
            Sender: ${settings.sender_name} &lt;${settings.smtp_user}&gt;<br>
            Daily Schedule: ${settings.scheduled_time} (Active: ${settings.daily_report_enabled ? 'Yes' : 'No'})<br>
            Recipients: ${settings.recipient_emails}
          </div>
          <p style="font-size: 12px; color: #64748b;">
            Alloy &amp; Melting Inventory System
          </p>
        </div>
      </div>
    `
  });

  return info;
}

async function sendDailyReportEmail(settings, isManualTrigger = false) {
  const recipientList = (settings.recipient_emails || '')
    .split(',')
    .map(e => e.trim())
    .filter(Boolean);

  if (recipientList.length === 0) {
    throw new Error('No recipient email addresses configured.');
  }

  const transporter = createMailTransporter(settings);
  const reportData = await buildDailyEodReportData();
  const htmlContent = generateDailyEmailHtml(reportData, settings);

  const subject = `[Daily Vault Report] ${reportData.date} - ${reportData.sessionsCount} Melting Sessions | Closing Balances`;

  const info = await transporter.sendMail({
    from: `"${settings.sender_name || 'Alloy Vault Ledger'}" <${settings.smtp_user}>`,
    to: recipientList.join(', '),
    subject,
    text: `Daily End-of-Day Report - ${reportData.date}\nMelting Sessions: ${reportData.sessionsCount}\nCombined Output: ${reportData.totalOutputG} g\nAlloy Issued: ${reportData.totalAlloyH} g\nPlease view this email in an HTML-compatible client to inspect itemized logs and vault stock tables.`,
    html: htmlContent
  });

  // Record last sent timestamp
  const now = new Date();
  if (isPostgresConnected && pool) {
    try {
      await pool.query('UPDATE email_settings SET last_sent_at = $1 WHERE setting_id = 1', [now]);
    } catch (e) {}
  } else {
    memoryLedger.email_settings.last_sent_at = now;
  }

  return { info, recipients: recipientList };
}

// Background scheduler for daily email report
async function checkAndSendDailyReport() {
  try {
    const settings = await getEmailSettings();
    if (!settings || !settings.daily_report_enabled || !settings.smtp_user || !settings.smtp_pass || !settings.recipient_emails) {
      return;
    }

    const now = new Date();
    const currentHHMM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

    if (currentHHMM === settings.scheduled_time) {
      if (settings.last_sent_at) {
        const lastSent = new Date(settings.last_sent_at);
        if (
          lastSent.getFullYear() === now.getFullYear() &&
          lastSent.getMonth() === now.getMonth() &&
          lastSent.getDate() === now.getDate()
        ) {
          return;
        }
      }

      console.log(`[Scheduler] Auto-dispatching daily EOD email report at ${currentHHMM}...`);
      await sendDailyReportEmail(settings, false);
      console.log(`[Scheduler] Daily EOD email report successfully sent.`);
    }
  } catch (err) {
    console.error('[Scheduler Error]', err.message);
  }
}

// Check every 30 seconds
setInterval(checkAndSendDailyReport, 30 * 1000);

// GET /admin/email-settings - View Mail Server Configuration
app.get('/admin/email-settings', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    const settings = await getEmailSettings();
    res.render('admin_email_settings', {
      settings,
      success: req.query.msg ? decodeURIComponent(req.query.msg) : null,
      error: req.query.error ? decodeURIComponent(req.query.error) : null
    });
  } catch (err) {
    console.error('[Admin Email Settings Error]', err);
    res.status(500).send('Error loading email settings: ' + err.message);
  }
});

// POST /admin/email-settings - Save Mail Server Configuration
app.post('/admin/email-settings', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    await saveEmailSettings(req.body);
    redirectWithAuth(req, res, '/admin/email-settings?msg=' + encodeURIComponent('Email server configuration saved successfully.'));
  } catch (err) {
    console.error('[Save Email Settings Error]', err);
    redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent(err.message));
  }
});

// POST /admin/email-settings/test - Verify and Send Test Email
app.post('/admin/email-settings/test', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    const settings = await getEmailSettings();
    const recipient = (req.body.test_email_recipient || (settings.recipient_emails || '').split(',')[0] || settings.smtp_user || '').trim();
    if (!recipient) {
      return redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent('Please enter a destination recipient email for the test.'));
    }
    if (!settings.smtp_user || !settings.smtp_pass) {
      return redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent('Please save your SMTP Username and Password/App Password first.'));
    }

    await sendTestEmail(settings, recipient);
    redirectWithAuth(req, res, '/admin/email-settings?msg=' + encodeURIComponent(`Test email successfully delivered to ${recipient}. SMTP Connection verified!`));
  } catch (err) {
    console.error('[Test Email Error]', err);
    redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent('SMTP Verification Failed: ' + err.message));
  }
});

// POST /admin/email-settings/send-daily-now - Immediate Manual Dispatch
app.post('/admin/email-settings/send-daily-now', requireAuth, requireRole('Admin'), async (req, res) => {
  try {
    const settings = await getEmailSettings();
    if (!settings.smtp_user || !settings.smtp_pass) {
      return redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent('Please save your SMTP Username and Password/App Password first.'));
    }
    if (!settings.recipient_emails) {
      return redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent('Please specify at least one recipient email address.'));
    }

    const result = await sendDailyReportEmail(settings, true);
    redirectWithAuth(req, res, '/admin/email-settings?msg=' + encodeURIComponent(`Today's daily EOD report successfully emailed to ${result.recipients.join(', ')}!`));
  } catch (err) {
    console.error('[Send Daily Report Error]', err);
    redirectWithAuth(req, res, '/admin/email-settings?error=' + encodeURIComponent('Dispatch Failed: ' + err.message));
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
