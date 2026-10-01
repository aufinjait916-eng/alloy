# Alloy & Melting Inventory Management System (Pure WebApp)

A production-ready, zero-build, self-contained web application engineered to track alloy inventory, precious metal vault balances, metallurgical melting rules, and crucible melting runs (`IN` / `OUT`).

Designed for storage on **GitHub**, containerized hosting on a **TrueNAS SCALE** server via **Docker Compose**, and backed by **PostgreSQL** with real-time stock computation views and atomic database transaction processing.

---

## 1. Architectural Highlights

- **Pure Zero-Build Architecture:** No React, Vue, Webpack, or Vite build steps required. Runs directly via `node server.js`.
- **Backend:** Node.js (v18+) with Express.js.
- **Frontend / Views:** Server-rendered HTML5 with **EJS (Embedded JavaScript)** templates, responsive industrial UI styled via **Tailwind CSS (CDN)**, and plain **Vanilla JavaScript** for real-time live search filtering, dynamic metallurgy recalculations, and modal balance impact warnings.
- **Database:** PostgreSQL (14 / 15 / 16 / 17) with the native `pg` driver, parameterized SQL queries, and the dynamic SQL view `vw_current_stock` (`SUM(IN) - SUM(OUT)`).
- **Session & Auth:** `express-session` backed by `connect-pg-simple` for persistent database session storage, `bcryptjs` password hashing, and custom Role-Based Access Control (RBAC) middleware.
- **Metallurgical Calculation Engine:** Dynamic charge calculator computing Target Weight ($G$), Required Alloy ($H$), and itemized alloy proportions with live vault stock checks.

---

## 2. User Roles & Security Matrix

| Role | Username | Default Password | Permissions & Capabilities |
| :--- | :--- | :--- | :--- |
| **Factory Manager** | `admin` | `Admin123!` | **Full Metallurgical & CRUD Access:** Configure melting rules; prepare & execute crucible sessions; add, edit, and delete transactions with stock impact warnings; manage metal catalog. |
| **Accounts User** | `accountant` | `Accounts123!` | **Read-Only Auditor:** View real-time alloy balances, completed melting sessions, and batch detail breakdowns. Mutation routes are protected by HTTP 403 Forbidden checks. |

---

## 3. Database Schema (`schema.sql`)

1. **`users`**: User authentication records (`user_id`, `username`, `password_hash`, `role`, `created_at`).
2. **`metal_master`**: Catalog of metals, purity grades, and measurement units (`metal_id`, `metal_name`, `purity_grade`, `track_inventory`, `uom`).
3. **`inventory_transactions`**: Vault movements (`transaction_id`, `metal_id`, `transaction_type` ['IN', 'OUT'], `quantity` [NUMERIC(12,3)], `entity_name`, `trans_date`).
4. **`vw_current_stock`**: Dynamic SQL view computing live balances per metal (`SUM(IN) - SUM(OUT)`).
5. **`melting_rules`**: Metallurgical rule configurations (`rule_id`, `scenario_name`, `target_purity`, `compute_parameter` ['C', 'E'], `compute_percentage`, `purity_min`, `purity_max`).
6. **`rule_components`**: Alloy composition breakdown proportions per rule (`component_id`, `rule_id`, `metal_id`, `percentage` summing to 100%).
7. **`melting_sessions`**: Header record for an executed melting batch run (`session_id`, `session_date`, `total_session_weight_g`, `total_session_alloy_h`).
8. **`melting_logs`**: Individual crucible charge batches belonging to a session (`melting_id`, `session_id`, `rule_id`, `input_c_pure_weight`, `input_d_pure_purity`, `input_e_metal_weight`, `input_f_metal_purity`, `total_weight_g`, `total_alloy_h`).
9. **`melting_log_details`**: Itemized alloy component weights issued for Required Alloy ($H$) (`detail_id`, `melting_id`, `metal_id`, `issued_weight`).
10. **`session`**: Persistent session store table for `connect-pg-simple`.

---

## 4. Metallurgical Calculation Formulas

Given:
- $C$: Pure Weight (grams)
- $D$: Pure Purity (%) (e.g. 99.90%) &rarr; Divided by 100 ($D / 100$)
- $E$: Metal / Scrap Weight (grams)
- $F$: Metal Purity (%) (e.g. 68.00%) &rarr; Divided by 100 ($F / 100$)
- Target Purity: e.g. 75.00% (18K), 58.50% (14K), 92.50% (925 Sterling) &rarr; Divided by 100 ($\text{TargetPurity} / 100$)
- Ratio Multiplier: Input as a percentage (e.g., enter 142.86 for a 1.4286 ratio) &rarr; Divided by 100 ($\text{compute\_percentage} / 100$)

1. **Compute Parameter Formula:**
   - If `compute_parameter == 'E'`:
     $$E = \text{Round}\left(C \times \frac{\text{compute\_percentage}}{100}, 3\right)$$
     *(Validates $F$ is within $[purity\_min, purity\_max]$)*
   - If `compute_parameter == 'C'`:
     $$C = \text{Round}\left(E \times \frac{\text{compute\_percentage}}{100}, 3\right)$$
     *(Validates $D$ is within $[purity\_min, purity\_max]$)*

2. **Target Charge Weight ($G$):**
   Values $D$ and $F$ are in percentages, so they are divided by 100 before the calculation of $G$:
   $$\text{Total Pure Metal} = \left(C \times \frac{D}{100}\right) + \left(E \times \frac{F}{100}\right)$$
   $$G = \text{Round}\left(\frac{\text{Total Pure Metal}}{\text{TargetPurity} / 100}, 3\right)$$

3. **Required Alloy Weight ($H$):**
   $$H = \text{Round}(G - (C + E), 3)$$

4. **Component Proportions Breakdown:**
   For each constituent alloy metal in `rule_components`:
   $$\text{issued\_weight} = \text{Round}(H \times \text{percentage}, 3)$$

---

## 5. Prepare & Execute Melting Session (Atomic Transaction)

- **Interactive Queue (`/melting/prepare`):**
  - Pick configured melting rule.
  - Enter inputs with real-time recalculation of $G$, $H$, and component allocations.
  - Live stock verification against `vw_current_stock`.
  - Add charges to active session queue with automatic batch numbering and removal.
  - Aggregation summary displays total $G$, total $H$, pure totals, and total alloy consumption vs vault inventory.
- **Atomic Database Execution (`POST /melting/process`):**
  - Executed inside a single **PostgreSQL Database Transaction (`BEGIN...COMMIT`)**:
    1. Inserts parent `melting_sessions` row.
    2. Loops through queued batches and inserts `melting_logs` and `melting_log_details`.
    3. Automatically generates corresponding `OUT` records in `inventory_transactions` for tracked alloy metals with `entity_name: 'Melting Batch #SessionID'`.

---

## 6. Local Quickstart (Development)

### Prerequisites
- Node.js 18+ & npm
- (Optional) Local PostgreSQL instance

### Running the App
1. **Clone and install dependencies:**
   ```bash
   git clone https://github.com/<your-username>/alloy-inventory-system.git
   cd alloy-inventory-system
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

3. **Start the server:**
   ```bash
   npm start
   # or
   node server.js
   ```

4. **Access the application:**
   Open [http://localhost:3000](http://localhost:3000) in your web browser.
   - Use the **Instant 1-Click Access** buttons on `/login` to sign in as either `admin` or `accountant`.

---

## 7. TrueNAS SCALE & Docker Deployment Guide

The repository includes a production-grade `Dockerfile` and `docker-compose.yml` pre-configured with container healthchecks, volume persistence, and automatic schema initialization.

### Step 1: Push Code to GitHub
```bash
git init
git add .
git commit -m "feat: complete alloy inventory and metallurgical melting session system"
git branch -M main
git remote add origin https://github.com/<your-username>/alloy-inventory-system.git
git push -u origin main
```

### Step 2: Prepare Storage Dataset in TrueNAS SCALE
1. Open the **TrueNAS SCALE Web UI**.
2. Navigate to **Datasets** &rarr; Select your pool (e.g. `tank`).
3. Click **Add Dataset** and create:
   - Path: `/mnt/tank/apps/alloy_vault`
   - Dataset: `db` (for PostgreSQL data files)
4. Ensure the dataset permissions permit read/write access for container users.

### Step 3: Deploy via TrueNAS SCALE Compose / Dockge / Portainer
1. Clone the repository into your TrueNAS apps directory via SSH:
   ```bash
   ssh admin@<truenas-ip>
   cd /mnt/tank/apps/alloy_vault
   git clone https://github.com/<your-username>/alloy-inventory-system.git app
   cd app
   ```
2. Copy environment configuration and edit credentials:
   ```bash
   cp .env.example .env
   nano .env
   ```
3. Start the stack:
   ```bash
   docker compose up -d --build
   ```

---

## 8. License

Apache-2.0 License. Built for TrueNAS SCALE, Docker, and industrial metallurgical facilities.
