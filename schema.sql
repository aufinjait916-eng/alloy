-- =======================================================================
-- Alloy Inventory & Melting Transactions Management System
-- Database Schema for PostgreSQL 14 / 15 / 16 / 17
-- =======================================================================

-- Ensure clean initialization if rebuilding
DROP VIEW IF EXISTS vw_current_stock CASCADE;
DROP TABLE IF EXISTS melting_log_details CASCADE;
DROP TABLE IF EXISTS melting_logs CASCADE;
DROP TABLE IF EXISTS melting_sessions CASCADE;
DROP TABLE IF EXISTS rule_components CASCADE;
DROP TABLE IF EXISTS melting_rules CASCADE;
DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS metal_master CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;

-- -----------------------------------------------------------------------
-- 1. Users Table
-- Supports Role-Based Access Control (RBAC): FactoryManager vs Accounts
-- -----------------------------------------------------------------------
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('FactoryManager', 'Accounts')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- 2. Metal Master Table
-- Catalog of base metals, alloys, purity grades, and measurement units
-- -----------------------------------------------------------------------
CREATE TABLE metal_master (
    metal_id SERIAL PRIMARY KEY,
    metal_name VARCHAR(100) NOT NULL,
    purity_grade VARCHAR(50) NOT NULL,
    track_inventory BOOLEAN DEFAULT TRUE,
    uom VARCHAR(10) DEFAULT 'g',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- 3. Inventory Transactions Table
-- Tracks every IN (incoming consignment/scrap) and OUT (crucible melt/dispatch)
-- -----------------------------------------------------------------------
CREATE TABLE inventory_transactions (
    transaction_id SERIAL PRIMARY KEY,
    metal_id INT NOT NULL REFERENCES metal_master(metal_id) ON DELETE CASCADE,
    transaction_type VARCHAR(5) NOT NULL CHECK (transaction_type IN ('IN', 'OUT')),
    quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    entity_name VARCHAR(150) NOT NULL,
    trans_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_metal_id ON inventory_transactions(metal_id);
CREATE INDEX idx_transactions_trans_date ON inventory_transactions(trans_date DESC);
CREATE INDEX idx_transactions_entity ON inventory_transactions(entity_name);

-- -----------------------------------------------------------------------
-- 4. Dynamic SQL View: vw_current_stock
-- Dynamically calculates CurrentBalance per metal (SUM(IN) - SUM(OUT))
-- -----------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_current_stock AS
SELECT 
    m.metal_id,
    m.metal_name,
    m.purity_grade,
    m.uom,
    m.track_inventory,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'IN' THEN t.quantity ELSE 0 END), 0)::NUMERIC(12,3) AS total_in,
    COALESCE(SUM(CASE WHEN t.transaction_type = 'OUT' THEN t.quantity ELSE 0 END), 0)::NUMERIC(12,3) AS total_out,
    (COALESCE(SUM(CASE WHEN t.transaction_type = 'IN' THEN t.quantity ELSE 0 END), 0) - 
     COALESCE(SUM(CASE WHEN t.transaction_type = 'OUT' THEN t.quantity ELSE 0 END), 0))::NUMERIC(12,3) AS current_balance
FROM metal_master m
LEFT JOIN inventory_transactions t ON m.metal_id = t.metal_id
GROUP BY m.metal_id, m.metal_name, m.purity_grade, m.uom, m.track_inventory;

-- -----------------------------------------------------------------------
-- 5. Persistent Session Store for express-session (connect-pg-simple)
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "session" (
    "sid" varchar NOT NULL COLLATE "default",
    "sess" json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- -----------------------------------------------------------------------
-- 6. Melting Rules Table (Factory Manager Only)
-- Configuration for melting metallurgy calculations
-- -----------------------------------------------------------------------
CREATE TABLE melting_rules (
    rule_id SERIAL PRIMARY KEY,
    scenario_name VARCHAR(100) NOT NULL,
    target_purity NUMERIC(5,2) NOT NULL,
    compute_parameter VARCHAR(1) NOT NULL CHECK (compute_parameter IN ('C', 'E')),
    compute_percentage NUMERIC(8,4) NOT NULL,
    purity_min NUMERIC(5,2) NOT NULL,
    purity_max NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- -----------------------------------------------------------------------
-- 7. Rule Components Table
-- Stores component alloy proportions (e.g., Copper 0.70, Silver 0.30)
-- -----------------------------------------------------------------------
CREATE TABLE rule_components (
    component_id SERIAL PRIMARY KEY,
    rule_id INT NOT NULL REFERENCES melting_rules(rule_id) ON DELETE CASCADE,
    metal_id INT NOT NULL REFERENCES metal_master(metal_id) ON DELETE CASCADE,
    percentage NUMERIC(5,4) NOT NULL CHECK (percentage > 0 AND percentage <= 1)
);

CREATE INDEX idx_rule_components_rule ON rule_components(rule_id);

-- -----------------------------------------------------------------------
-- 8. Melting Sessions Table
-- Header record for an executed melting batch run
-- -----------------------------------------------------------------------
CREATE TABLE melting_sessions (
    session_id SERIAL PRIMARY KEY,
    session_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    total_session_weight_g NUMERIC(12,3) NOT NULL,
    total_session_alloy_h NUMERIC(12,3) NOT NULL
);

-- -----------------------------------------------------------------------
-- 9. Melting Logs Table
-- Individual batch logs belonging to a melting session
-- -----------------------------------------------------------------------
CREATE TABLE melting_logs (
    melting_id SERIAL PRIMARY KEY,
    session_id INT NOT NULL REFERENCES melting_sessions(session_id) ON DELETE CASCADE,
    rule_id INT REFERENCES melting_rules(rule_id) ON DELETE SET NULL,
    input_c_pure_weight NUMERIC(12,3) NOT NULL,
    input_d_pure_purity NUMERIC(5,2) NOT NULL,
    input_e_metal_weight NUMERIC(12,3) NOT NULL,
    input_f_metal_purity NUMERIC(5,2) NOT NULL,
    total_weight_g NUMERIC(12,3) NOT NULL,
    total_alloy_h NUMERIC(12,3) NOT NULL
);

CREATE INDEX idx_melting_logs_session ON melting_logs(session_id);

-- -----------------------------------------------------------------------
-- 10. Melting Log Details Table
-- Itemized alloy metal weights issued to satisfy Required Alloy H
-- -----------------------------------------------------------------------
CREATE TABLE melting_log_details (
    detail_id SERIAL PRIMARY KEY,
    melting_id INT NOT NULL REFERENCES melting_logs(melting_id) ON DELETE CASCADE,
    metal_id INT NOT NULL REFERENCES metal_master(metal_id),
    issued_weight NUMERIC(12,3) NOT NULL
);

CREATE INDEX idx_melting_details_log ON melting_log_details(melting_id);

-- -----------------------------------------------------------------------
-- 11. Initial Seed Data
-- Users:
--   'admin'      -> 'Admin123!'
--   'accountant' -> 'Accounts123!'
-- -----------------------------------------------------------------------
INSERT INTO users (username, password_hash, role) VALUES
('admin', '$2b$10$MgT2xGJ4T0tf5/Wj1tfbL.Ufpsy63gdtwxoN4NYSHmZsuXqBb7iPG', 'FactoryManager'),
('accountant', '$2b$10$ummAdFcHx/NzIKFc6DYtBOwoJByVLuDoL2IqGhbkrW6EIUVg3S7ZG', 'Accounts');

-- Metal Master Seed Items
INSERT INTO metal_master (metal_name, purity_grade, track_inventory, uom) VALUES
('Pure Gold', '24K (99.99%)', TRUE, 'g'),
('Fine Silver', '999 Grade (99.9%)', TRUE, 'g'),
('Electrolytic Copper', 'OFHC Grade (99.95%)', TRUE, 'g'),
('Sterling Silver Ingot', '925 Alloy', TRUE, 'g'),
('Yellow Gold Alloy', '18K (75.0%)', TRUE, 'g'),
('Platinum Standard', '950 Fine', TRUE, 'g');

-- Initial Transactions (Vault movements, vendor consignments, melting charges)
INSERT INTO inventory_transactions (metal_id, transaction_type, quantity, entity_name, trans_date) VALUES
(1, 'IN', 2500.000, 'Bullion Refinery Supplier #A12', CURRENT_TIMESTAMP - INTERVAL '6 days'),
(1, 'OUT', 350.000, 'Furnace #1 Melting Charge - Batch #F24-01', CURRENT_TIMESTAMP - INTERVAL '5 days'),
(1, 'OUT', 225.500, 'Crucible Cast Ring Blanks - Run #98', CURRENT_TIMESTAMP - INTERVAL '3 days'),
(2, 'IN', 10000.000, 'Silver Ingot Consignment - Ref #SI-904', CURRENT_TIMESTAMP - INTERVAL '6 days'),
(2, 'OUT', 1200.000, 'Induction Furnace Melt - Sterling Bar Prep', CURRENT_TIMESTAMP - INTERVAL '4 days'),
(3, 'IN', 15000.000, 'Copper Granules Delivery - Apex Metal Corp', CURRENT_TIMESTAMP - INTERVAL '7 days'),
(3, 'OUT', 2500.000, 'Master Alloy Alloying Additive Charge #C3', CURRENT_TIMESTAMP - INTERVAL '4 days'),
(4, 'IN', 3500.000, 'Return Scrap from Casting Workshop', CURRENT_TIMESTAMP - INTERVAL '4 days'),
(4, 'OUT', 950.000, 'Sheet Rolling Mill Line 2', CURRENT_TIMESTAMP - INTERVAL '1 day'),
(5, 'IN', 1200.000, 'Initial Stock Vault Balance', CURRENT_TIMESTAMP - INTERVAL '7 days'),
(6, 'IN', 800.000, 'Laboratory Vault Standard Ingot', CURRENT_TIMESTAMP - INTERVAL '7 days');

-- -----------------------------------------------------------------------
-- 12. Melting Rules & Alloy Proportions Seed
-- Note: compute_percentage is entered and stored as percentage (e.g. 142.86 for 1.4286 ratio)
-- -----------------------------------------------------------------------
-- Rule 1: 18K Yellow Gold Standard (Target: 75.00%, Compute: 'E' pure -> metal)
INSERT INTO melting_rules (rule_id, scenario_name, target_purity, compute_parameter, compute_percentage, purity_min, purity_max) VALUES
(1, '18K Yellow Gold Ingot Melt', 75.00, 'E', 25.0000, 50.00, 80.00),
(2, '14K Rose Gold Crucible Run', 58.50, 'E', 35.0000, 45.00, 70.00),
(3, '925 Sterling Silver Casting Bar', 92.50, 'C', 50.0000, 99.00, 99.99),
(4, '14K Custom Crown Gold (142.86%)', 58.50, 'E', 142.8600, 40.00, 75.00);

SELECT setval('melting_rules_rule_id_seq', 4);

-- Components for Rule 1 (18K: 60% Copper + 40% Silver)
INSERT INTO rule_components (rule_id, metal_id, percentage) VALUES
(1, 3, 0.6000), -- Electrolytic Copper 60%
(1, 2, 0.4000); -- Fine Silver 40%

-- Components for Rule 2 (14K Rose: 80% Copper + 20% Silver)
INSERT INTO rule_components (rule_id, metal_id, percentage) VALUES
(2, 3, 0.8000), -- Electrolytic Copper 80%
(2, 2, 0.2000); -- Fine Silver 20%

-- Components for Rule 3 (Sterling: 100% Copper)
INSERT INTO rule_components (rule_id, metal_id, percentage) VALUES
(3, 3, 1.0000); -- Electrolytic Copper 100%

-- Components for Rule 4 (14K Custom: 70% Copper + 30% Silver)
INSERT INTO rule_components (rule_id, metal_id, percentage) VALUES
(4, 3, 0.7000), -- Electrolytic Copper 70%
(4, 2, 0.3000); -- Fine Silver 30%

-- Initial Melting Session Seed (Session #1)
INSERT INTO melting_sessions (session_id, session_date, total_session_weight_g, total_session_alloy_h) VALUES
(1, CURRENT_TIMESTAMP - INTERVAL '2 days', 467.600, 92.600);

SELECT setval('melting_sessions_session_id_seq', 1);

INSERT INTO melting_logs (melting_id, session_id, rule_id, input_c_pure_weight, input_d_pure_purity, input_e_metal_weight, input_f_metal_purity, total_weight_g, total_alloy_h) VALUES
(1, 1, 1, 300.000, 99.90, 75.000, 68.00, 467.600, 92.600);

SELECT setval('melting_logs_melting_id_seq', 1);

INSERT INTO melting_log_details (melting_id, metal_id, issued_weight) VALUES
(1, 3, 55.560), -- 60% of 92.600 = 55.560g Copper
(1, 2, 37.040); -- 40% of 92.600 = 37.040g Silver
