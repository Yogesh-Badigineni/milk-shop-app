/**
 * =====================================================
 * MilkFlow — Milk Shop Management Application
 * Complete Business Logic & Data Layer
 * =====================================================
 */

const MilkApp = (() => {
  'use strict';

  // =============== DATABASE LAYER (localStorage) ===============
  const DB_KEYS = {
    suppliers: 'mf_suppliers',
    stockEntries: 'mf_stock_entries',
    storageLogs: 'mf_storage_logs',
    sales: 'mf_sales',
    closings: 'mf_closings',
    settings: 'mf_settings',
    users: 'mf_users',
    session: 'mf_session',
    backupLog: 'mf_backup_log',
    activities: 'mf_activities',
    currentStock: 'mf_current_stock',
  };

  function dbGet(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || null;
    } catch { return null; }
  }

  function dbSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function dbGetList(key) {
    return dbGet(key) || [];
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function nowTimestamp() {
    return new Date().toISOString();
  }

  function formatCurrency(n) {
    return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function formatQty(n) {
    return Number(n || 0).toFixed(1) + ' L';
  }

  function formatTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  // =============== INITIALIZATION ===============
  async function initDefaults() {
    // Default users (with hashed passwords)
    if (!dbGet(DB_KEYS.users)) {
      const ownerHash = await MilkSecurity.hashPassword('Owner@123');
      const staffHash = await MilkSecurity.hashPassword('Staff@123');
      dbSet(DB_KEYS.users, [
        { username: 'owner', passwordHash: ownerHash.hash, salt: ownerHash.salt, role: 'owner', name: 'Shop Owner' },
        { username: 'staff', passwordHash: staffHash.hash, salt: staffHash.salt, role: 'staff', name: 'Staff Member' },
      ]);
      localStorage.setItem('mf_security_version', '2');
    } else if (!localStorage.getItem('mf_security_version')) {
      // Force reset: old data exists without security version marker
      // Reset users to new strong defaults
      const ownerHash = await MilkSecurity.hashPassword('Owner@123');
      const staffHash = await MilkSecurity.hashPassword('Staff@123');
      const existingUsers = dbGetList(DB_KEYS.users);
      const updatedUsers = existingUsers.map(u => {
        if (u.username === 'owner' && u.role === 'owner') {
          return { username: 'owner', passwordHash: ownerHash.hash, salt: ownerHash.salt, role: 'owner', name: u.name || 'Shop Owner' };
        }
        if (u.username === 'staff' && u.role === 'staff') {
          return { username: 'staff', passwordHash: staffHash.hash, salt: staffHash.salt, role: 'staff', name: u.name || 'Staff Member' };
        }
        return u; // Keep custom users
      });
      dbSet(DB_KEYS.users, updatedUsers);
      localStorage.setItem('mf_security_version', '2');
      MilkSecurity.auditLog('SECURITY_UPGRADE', 'Reset default user credentials to strong passwords', 'system');
      // Migrate any remaining custom users with plain-text passwords
      await migratePasswords();
    }
    // Default settings
    if (!dbGet(DB_KEYS.settings)) {
      dbSet(DB_KEYS.settings, {
        shopName: 'My Milk Shop',
        shopAddress: '',
        shopPhone: '',
        defaultPrice: 50,
      });
    }
    // Initialize current stock if not set
    if (dbGet(DB_KEYS.currentStock) === null) {
      dbSet(DB_KEYS.currentStock, 0);
    }
  }

  async function migratePasswords() {
    const users = dbGetList(DB_KEYS.users);
    let migrated = false;

    // Known weak default passwords that must be upgraded
    const defaultWeakPasswords = ['owner123', 'staff123', 'admin', 'password', '1234'];

    for (let i = 0; i < users.length; i++) {
      if (users[i].password && !users[i].passwordHash) {
        // If it's a known default/weak password, replace with strong default
        let newPassword = users[i].password;
        if (defaultWeakPasswords.includes(users[i].password)) {
          newPassword = users[i].role === 'owner' ? 'Owner@123' : 'Staff@123';
        }
        const result = await MilkSecurity.hashPassword(newPassword);
        users[i].passwordHash = result.hash;
        users[i].salt = result.salt;
        delete users[i].password;
        migrated = true;
      }
    }
    if (migrated) {
      dbSet(DB_KEYS.users, users);
      MilkSecurity.auditLog('PASSWORD_MIGRATION', 'Migrated and strengthened passwords', 'system');
    }
  }

  async function init() {
    await initDefaults();
    checkSession();
    updateHeaderDate();
    setInterval(updateHeaderDate, 60000);

    // Set up session expiry handler
    MilkSecurity.onSessionExpired(() => {
      toast('warning', 'Session Expired', 'You have been logged out due to inactivity');
      MilkSecurity.auditLog('SESSION_EXPIRED', 'Session expired due to inactivity', currentUser?.username);
      logout();
    });

    // Extend session button
    const extendBtn = document.getElementById('extendSessionBtn');
    if (extendBtn) {
      extendBtn.addEventListener('click', () => {
        MilkSecurity.refreshSession();
        document.getElementById('sessionTimeoutBanner').classList.remove('show');
        toast('success', 'Session Extended', 'Your session has been extended');
      });
    }
  }

  // =============== AUTH ===============
  let currentUser = null;

  function checkSession() {
    const session = MilkSecurity.getSession();
    if (session) {
      currentUser = { username: session.username, role: session.role, name: session.name };
      showApp();
    } else {
      showLogin();
    }
  }

  function showLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('appContainer').style.display = 'none';
    // Show rate limit status
    updateRateLimitDisplay();
  }

  function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appContainer').style.display = '';
    updateUserInfo();
    navigate('dashboard');
    checkDayLocked();
  }

  function updateRateLimitDisplay() {
    const rateLimit = MilkSecurity.isLoginLocked();
    const el = document.getElementById('loginRateLimit');
    if (el && rateLimit.locked) {
      el.style.display = '';
      el.textContent = '🔒 ' + rateLimit.message;
    } else if (el) {
      el.style.display = 'none';
    }
  }

  async function login(username, password, role) {
    // Check rate limiting first
    const rateLimit = MilkSecurity.isLoginLocked();
    if (rateLimit.locked) {
      toast('error', 'Account Locked', rateLimit.message);
      updateRateLimitDisplay();
      return false;
    }

    const users = dbGetList(DB_KEYS.users);
    const user = users.find(u => u.username === username && u.role === role);

    if (user && user.passwordHash) {
      const isValid = await MilkSecurity.verifyPassword(password, user.passwordHash, user.salt);
      if (isValid) {
        currentUser = { username: user.username, role: user.role, name: user.name };
        MilkSecurity.createSession(currentUser);
        MilkSecurity.recordLoginAttempt(username, true);
        MilkSecurity.auditLog('LOGIN_SUCCESS', `User logged in as ${role}`, username);
        showApp();
        toast('success', 'Welcome back!', `Logged in as ${user.name}`);
        return true;
      }
    }

    // Failed login
    MilkSecurity.recordLoginAttempt(username, false);
    MilkSecurity.auditLog('LOGIN_FAILED', `Failed login attempt for role: ${role}`, username);
    updateRateLimitDisplay();
    return false;
  }

  function logout() {
    MilkSecurity.auditLog('LOGOUT', 'User logged out', currentUser?.username);
    currentUser = null;
    MilkSecurity.destroySession();
    showLogin();
  }

  function updateUserInfo() {
    if (!currentUser) return;
    document.getElementById('userName').textContent = currentUser.name;
    document.getElementById('userRole').textContent = currentUser.role === 'owner' ? 'Owner Access' : 'Staff Access';
    document.getElementById('userAvatar').textContent = currentUser.name.charAt(0).toUpperCase();

    // Owner-only controls
    const closeDaySection = document.getElementById('closeDaySection');
    if (closeDaySection) {
      closeDaySection.style.display = currentUser.role === 'owner' ? '' : 'none';
    }

    // Populate account settings
    document.getElementById('accUsername').textContent = currentUser.username;
    document.getElementById('accRole').textContent = currentUser.role === 'owner' ? 'Owner' : 'Staff';
  }

  // =============== NAVIGATION ===============
  const pageTitles = {
    dashboard: { title: 'Dashboard', subtitle: "Overview of today's operations" },
    suppliers: { title: 'Suppliers', subtitle: 'Manage your milk suppliers' },
    stock: { title: 'Stock Entry', subtitle: 'Record milk purchases' },
    storage: { title: 'Storage Log', subtitle: 'Track milk storage conditions' },
    sales: { title: 'Sales', subtitle: 'Record and track sales' },
    closing: { title: 'Day Closing', subtitle: 'End of day summary & lock' },
    backup: { title: 'Backup', subtitle: 'Export & restore your data' },
    settings: { title: 'Settings', subtitle: 'Configure your shop' },
  };

  function navigate(page) {
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // Update page views
    document.querySelectorAll('.page-view').forEach(view => {
      view.classList.remove('active');
    });
    const pageEl = document.getElementById('page' + page.charAt(0).toUpperCase() + page.slice(1));
    if (pageEl) pageEl.classList.add('active');

    // Update title
    const info = pageTitles[page] || { title: page, subtitle: '' };
    document.getElementById('pageTitle').textContent = info.title;
    document.getElementById('pageSubtitle').textContent = info.subtitle;

    // Refresh data for the page
    refreshPage(page);

    // Close mobile sidebar
    closeSidebar();
  }

  function refreshPage(page) {
    switch (page) {
      case 'dashboard': refreshDashboard(); break;
      case 'suppliers': refreshSuppliers(); break;
      case 'stock': refreshStock(); break;
      case 'storage': refreshStorage(); break;
      case 'sales': refreshSales(); break;
      case 'closing': refreshClosing(); break;
      case 'backup': refreshBackupLog(); break;
      case 'settings': loadSettings(); break;
    }
  }

  // =============== HEADER ===============
  function updateHeaderDate() {
    const now = new Date();
    const options = { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' };
    document.getElementById('headerDate').textContent = now.toLocaleDateString('en-IN', options);
  }

  // =============== DAY LOCK ===============
  function isDayLocked(date) {
    const closings = dbGetList(DB_KEYS.closings);
    return closings.some(c => c.date === (date || todayStr()));
  }

  function checkDayLocked() {
    const banner = document.getElementById('dayLockedBanner');
    if (isDayLocked()) {
      banner.classList.add('show');
    } else {
      banner.classList.remove('show');
    }
  }

  // =============== TOAST SYSTEM ===============
  function toast(type, title, message) {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const toastEl = document.createElement('div');
    toastEl.className = `toast ${type}`;

    const iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    iconSpan.textContent = icons[type] || 'ℹ️';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'toast-content';
    const titleDiv = document.createElement('div');
    titleDiv.className = 'toast-title';
    titleDiv.textContent = title;
    const msgDiv = document.createElement('div');
    msgDiv.className = 'toast-message';
    msgDiv.textContent = message;
    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(msgDiv);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => toastEl.remove());

    toastEl.appendChild(iconSpan);
    toastEl.appendChild(contentDiv);
    toastEl.appendChild(closeBtn);

    container.appendChild(toastEl);
    setTimeout(() => {
      if (toastEl.parentElement) {
        toastEl.style.transition = 'all 0.3s ease';
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translateX(100%)';
        setTimeout(() => toastEl.remove(), 300);
      }
    }, 4000);
  }

  // =============== MODAL SYSTEM ===============
  function openModal(id) {
    document.getElementById(id).classList.add('active');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('active');
  }

  // =============== CONFIRM DIALOG ===============
  let confirmCallback = null;

  function showConfirm(icon, title, message, btnText, btnClass, callback) {
    document.getElementById('confirmIcon').textContent = icon;
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const btn = document.getElementById('confirmActionBtn');
    btn.textContent = btnText;
    btn.className = `btn ${btnClass}`;
    confirmCallback = callback;
    document.getElementById('confirmOverlay').classList.add('active');
  }

  function closeConfirm() {
    document.getElementById('confirmOverlay').classList.remove('active');
    confirmCallback = null;
  }

  function executeConfirm() {
    if (confirmCallback) confirmCallback();
    closeConfirm();
  }

  // =============== ACTIVITIES ===============
  function addActivity(type, text) {
    const activities = dbGetList(DB_KEYS.activities);
    activities.unshift({
      id: generateId(),
      type,
      text,
      timestamp: nowTimestamp(),
    });
    // Keep last 50 activities
    if (activities.length > 50) activities.length = 50;
    dbSet(DB_KEYS.activities, activities);
  }

  function renderActivities() {
    const activities = dbGetList(DB_KEYS.activities).slice(0, 10);
    const list = document.getElementById('activityList');
    if (activities.length === 0) {
      list.innerHTML = `
        <li class="empty-state" style="padding:24px 0;">
          <div class="empty-icon">📭</div>
          <h4>No activity yet</h4>
          <p>Start by adding a supplier or recording a sale</p>
        </li>`;
      return;
    }
    list.innerHTML = activities.map(a => `
      <li class="activity-item">
        <span class="activity-dot ${a.type}"></span>
        <span class="activity-text">${a.text}</span>
        <span class="activity-time">${formatTime(a.timestamp)}</span>
      </li>
    `).join('');
  }

  // =============== DASHBOARD ===============
  function refreshDashboard() {
    const today = todayStr();
    const stock = dbGet(DB_KEYS.currentStock) || 0;
    const suppliers = dbGetList(DB_KEYS.suppliers).filter(s => s.status === 'active');
    const todaySales = dbGetList(DB_KEYS.sales).filter(s => s.date === today);
    const todayStock = dbGetList(DB_KEYS.stockEntries).filter(s => s.date === today);

    const totalRevenue = todaySales.reduce((sum, s) => sum + Number(s.amount), 0);
    const cashRevenue = todaySales.filter(s => s.paymentMode === 'cash').reduce((sum, s) => sum + Number(s.amount), 0);
    const upiRevenue = todaySales.filter(s => s.paymentMode === 'upi').reduce((sum, s) => sum + Number(s.amount), 0);
    const totalPurchased = todayStock.reduce((sum, s) => sum + Number(s.quantity), 0);
    const totalSold = todaySales.reduce((sum, s) => sum + Number(s.quantity), 0);

    document.getElementById('dashStock').textContent = formatQty(stock);
    document.getElementById('dashRevenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('dashSalesCount').textContent = todaySales.length;
    document.getElementById('dashSuppliers').textContent = suppliers.length;

    document.getElementById('dashCashSales').textContent = formatCurrency(cashRevenue);
    document.getElementById('dashUpiSales').textContent = formatCurrency(upiRevenue);
    document.getElementById('dashPurchased').textContent = formatQty(totalPurchased);
    document.getElementById('dashSold').textContent = formatQty(totalSold);
    document.getElementById('dashNet').textContent = formatCurrency(totalRevenue - todayStock.reduce((sum, s) => sum + Number(s.cost), 0));

    // Change indicators
    document.getElementById('dashStockChange').textContent = stock > 0 ? `Available for sale` : 'No stock';
    document.getElementById('dashRevenueChange').textContent = totalRevenue > 0 ? `${todaySales.length} transactions today` : 'No sales yet';
    document.getElementById('dashSalesChange').textContent = todaySales.length > 0 ? `${formatQty(totalSold)} sold` : '—';
    document.getElementById('dashSupChange').textContent = suppliers.length > 0 ? `${suppliers.length} active` : '—';

    renderActivities();
    checkDayLocked();
  }

  // =============== SUPPLIER MANAGEMENT ===============
  function refreshSuppliers() {
    const suppliers = dbGetList(DB_KEYS.suppliers);
    const tbody = document.getElementById('supplierTableBody');
    const empty = document.getElementById('supplierEmpty');
    const table = document.getElementById('supplierTable');

    if (suppliers.length === 0) {
      table.style.display = 'none';
      empty.style.display = '';
      return;
    }

    table.style.display = '';
    empty.style.display = 'none';

    const stockEntries = dbGetList(DB_KEYS.stockEntries);

    tbody.innerHTML = suppliers.map(sup => {
      const supStock = stockEntries.filter(e => e.supplierId === sup.id);
      const totalSupplied = supStock.reduce((s, e) => s + Number(e.quantity), 0);
      const totalPaid = supStock.reduce((s, e) => s + Number(e.cost), 0);

      return `
        <tr>
          <td>
            <div class="fw-bold">${escHtml(sup.name)}</div>
            <div class="text-muted" style="font-size:0.75rem;">${escHtml(sup.address || '—')}</div>
          </td>
          <td class="font-mono" style="font-size:0.82rem;">${escHtml(sup.contact)}</td>
          <td class="fw-bold">${formatQty(totalSupplied)}</td>
          <td class="fw-bold">${formatCurrency(totalPaid)}</td>
          <td class="fw-bold text-warning">${formatCurrency(0)}</td>
          <td>
            <span class="badge ${sup.status === 'active' ? 'badge-success' : 'badge-danger'}">
              ${sup.status === 'active' ? 'Active' : 'Inactive'}
            </span>
          </td>
          <td>
            <div class="flex gap-sm">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="MilkApp.editSupplier('${sup.id}')" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="MilkApp.toggleSupplierStatus('${sup.id}')" title="Toggle Status">
                ${sup.status === 'active' ? '🔴' : '🟢'}
              </button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="MilkApp.deleteSupplierConfirm('${sup.id}')" title="Delete">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function showSupplierModal(editId) {
    const form = document.getElementById('supplierForm');
    form.reset();
    document.getElementById('supplierId').value = '';

    if (editId) {
      const suppliers = dbGetList(DB_KEYS.suppliers);
      const sup = suppliers.find(s => s.id === editId);
      if (sup) {
        document.getElementById('supplierModalTitle').textContent = 'Edit Supplier';
        document.getElementById('supplierId').value = sup.id;
        document.getElementById('supplierName').value = sup.name;
        document.getElementById('supplierContact').value = sup.contact;
        document.getElementById('supplierAddress').value = sup.address || '';
      }
    } else {
      document.getElementById('supplierModalTitle').textContent = 'Add Supplier';
    }
    openModal('supplierModal');
  }

  function saveSupplier() {
    const name = document.getElementById('supplierName').value.trim();
    const contact = document.getElementById('supplierContact').value.trim();
    const address = document.getElementById('supplierAddress').value.trim();
    const editId = document.getElementById('supplierId').value;

    if (!name || !contact) {
      toast('error', 'Validation Error', 'Supplier name and contact are required');
      return;
    }

    const suppliers = dbGetList(DB_KEYS.suppliers);

    if (editId) {
      const idx = suppliers.findIndex(s => s.id === editId);
      if (idx >= 0) {
        suppliers[idx].name = name;
        suppliers[idx].contact = contact;
        suppliers[idx].address = address;
        toast('success', 'Supplier Updated', `${name} has been updated`);
        addActivity('purchase', `Updated supplier <strong>${name}</strong>`);
      }
    } else {
      suppliers.push({
        id: generateId(),
        name,
        contact,
        address,
        status: 'active',
        createdAt: nowTimestamp(),
      });
      toast('success', 'Supplier Added', `${name} has been added`);
      addActivity('purchase', `Added new supplier <strong>${name}</strong>`);
    }

    dbSet(DB_KEYS.suppliers, suppliers);
    closeModal('supplierModal');
    refreshSuppliers();
    refreshDashboard();
  }

  function editSupplier(id) {
    showSupplierModal(id);
  }

  function toggleSupplierStatus(id) {
    const suppliers = dbGetList(DB_KEYS.suppliers);
    const sup = suppliers.find(s => s.id === id);
    if (sup) {
      sup.status = sup.status === 'active' ? 'inactive' : 'active';
      dbSet(DB_KEYS.suppliers, suppliers);
      toast('info', 'Status Changed', `${sup.name} is now ${sup.status}`);
      refreshSuppliers();
    }
  }

  function deleteSupplierConfirm(id) {
    const suppliers = dbGetList(DB_KEYS.suppliers);
    const sup = suppliers.find(s => s.id === id);
    if (!sup) return;
    showConfirm('🗑️', 'Delete Supplier?', `Are you sure you want to delete "${sup.name}"? This cannot be undone.`, 'Delete', 'btn-danger', () => {
      const updated = dbGetList(DB_KEYS.suppliers).filter(s => s.id !== id);
      dbSet(DB_KEYS.suppliers, updated);
      toast('success', 'Supplier Deleted', `${sup.name} has been removed`);
      addActivity('alert', `Deleted supplier <strong>${sup.name}</strong>`);
      refreshSuppliers();
    });
  }

  // =============== STOCK MANAGEMENT ===============
  function refreshStock() {
    // Populate supplier dropdown
    const suppliers = dbGetList(DB_KEYS.suppliers).filter(s => s.status === 'active');
    const select = document.getElementById('stockSupplier');
    const currentVal = select.value;
    select.innerHTML = '<option value="">Select Supplier</option>' +
      suppliers.map(s => `<option value="${s.id}" ${s.id === currentVal ? 'selected' : ''}>${escHtml(s.name)}</option>`).join('');

    // Set default date
    if (!document.getElementById('stockDate').value) {
      document.getElementById('stockDate').value = todayStr();
    }

    // Render stock entries
    renderStockEntries();
  }

  function renderStockEntries() {
    const entries = dbGetList(DB_KEYS.stockEntries).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
    const container = document.getElementById('stockEntriesList');

    if (entries.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:32px 0">
          <div class="empty-icon">📦</div>
          <h4>No stock entries yet</h4>
          <p>Record your first milk purchase</p>
        </div>`;
      return;
    }

    const suppliers = dbGetList(DB_KEYS.suppliers);

    container.innerHTML = entries.map(e => {
      const sup = suppliers.find(s => s.id === e.supplierId);
      return `
        <div class="activity-item" style="padding:12px 0;">
          <span class="activity-dot purchase"></span>
          <div style="flex:1;">
            <div class="fw-bold" style="font-size:0.88rem;">
              ${formatQty(e.quantity)} from ${escHtml(sup ? sup.name : 'Unknown')}
            </div>
            <div class="text-muted" style="font-size:0.75rem;">
              ${formatDate(e.date)} • ${formatCurrency(e.cost)} paid
              ${e.notes ? ' • ' + escHtml(e.notes) : ''}
            </div>
          </div>
          <span class="badge badge-primary">${formatCurrency(e.cost)}</span>
        </div>`;
    }).join('');
  }

  function addStockEntry(date, supplierId, quantity, cost, notes) {
    if (isDayLocked(date)) {
      toast('error', 'Day Locked', 'Cannot add entries for a closed day');
      return false;
    }

    const entry = {
      id: generateId(),
      date,
      supplierId,
      quantity: Number(quantity),
      cost: Number(cost),
      notes: notes || '',
      timestamp: nowTimestamp(),
    };

    const entries = dbGetList(DB_KEYS.stockEntries);
    entries.push(entry);
    dbSet(DB_KEYS.stockEntries, entries);

    // Update current stock
    const currentStock = (dbGet(DB_KEYS.currentStock) || 0) + Number(quantity);
    dbSet(DB_KEYS.currentStock, currentStock);

    const sup = dbGetList(DB_KEYS.suppliers).find(s => s.id === supplierId);
    addActivity('purchase', `Received <strong>${formatQty(quantity)}</strong> from <strong>${sup ? sup.name : 'Unknown'}</strong>`);

    return true;
  }

  // =============== STORAGE LOG ===============
  function refreshStorage() {
    if (!document.getElementById('storageDate').value) {
      document.getElementById('storageDate').value = todayStr();
    }
    renderStorageLogs();
  }

  function renderStorageLogs() {
    const logs = dbGetList(DB_KEYS.storageLogs).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 20);
    const container = document.getElementById('storageLogList');

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:32px 0">
          <div class="empty-icon">🏪</div>
          <h4>No storage logs yet</h4>
          <p>Start logging your milk storage</p>
        </div>`;
      return;
    }

    container.innerHTML = logs.map(log => `
      <div class="activity-item" style="padding:12px 0;">
        <span class="activity-dot closing"></span>
        <div style="flex:1;">
          <div class="fw-bold" style="font-size:0.88rem;">
            ${formatQty(log.quantity)} stored
          </div>
          <div class="text-muted" style="font-size:0.75rem;">
            ${formatDate(log.date)} • ${formatTime(log.timestamp)}
            ${log.notes ? '<br>' + escHtml(log.notes) : ''}
          </div>
        </div>
        <span class="badge badge-accent">${formatQty(log.quantity)}</span>
      </div>
    `).join('');
  }

  function addStorageLog(date, quantity, notes) {
    const log = {
      id: generateId(),
      date,
      quantity: Number(quantity),
      notes: notes || '',
      timestamp: nowTimestamp(),
    };

    const logs = dbGetList(DB_KEYS.storageLogs);
    logs.push(log);
    dbSet(DB_KEYS.storageLogs, logs);

    addActivity('closing', `Stored <strong>${formatQty(quantity)}</strong> in storage`);
    return true;
  }

  // =============== SALES ===============
  function refreshSales() {
    if (!document.getElementById('saleDate').value) {
      document.getElementById('saleDate').value = todayStr();
    }

    const today = todayStr();
    const allSales = dbGetList(DB_KEYS.sales);
    const todaySales = allSales.filter(s => s.date === today);
    const stock = dbGet(DB_KEYS.currentStock) || 0;
    const todayStock = dbGetList(DB_KEYS.stockEntries).filter(s => s.date === today);
    const todaySold = todaySales.reduce((sum, s) => sum + Number(s.quantity), 0);
    const todayPurchased = todayStock.reduce((sum, s) => sum + Number(s.quantity), 0);

    const cashTotal = todaySales.filter(s => s.paymentMode === 'cash').reduce((sum, s) => sum + Number(s.amount), 0);
    const upiTotal = todaySales.filter(s => s.paymentMode === 'upi').reduce((sum, s) => sum + Number(s.amount), 0);

    document.getElementById('salesTotalCount').textContent = todaySales.length;
    document.getElementById('salesTotalCash').textContent = formatCurrency(cashTotal);
    document.getElementById('salesTotalUpi').textContent = formatCurrency(upiTotal);
    document.getElementById('salesTotalRevenue').textContent = formatCurrency(cashTotal + upiTotal);

    document.getElementById('salesAvailStock').textContent = formatQty(stock);
    document.getElementById('salesTodayPurchased').textContent = formatQty(todayPurchased);
    document.getElementById('salesTodaySold').textContent = formatQty(todaySold);

    renderSalesTable(allSales);
  }

  function renderSalesTable(salesList) {
    const tbody = document.getElementById('salesTableBody');
    const empty = document.getElementById('salesEmpty');

    if (!salesList) salesList = dbGetList(DB_KEYS.sales);

    // Sort by most recent
    const sorted = [...salesList].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (sorted.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';
    tbody.innerHTML = sorted.slice(0, 50).map(s => `
      <tr>
        <td>${formatDate(s.date)}</td>
        <td>${escHtml(s.customer || 'Walk-in')}</td>
        <td class="fw-bold">${formatQty(s.quantity)}</td>
        <td class="fw-bold">${formatCurrency(s.amount)}</td>
        <td>
          <span class="badge ${s.paymentMode === 'cash' ? 'badge-success' : 'badge-primary'}">
            ${s.paymentMode === 'cash' ? '💵 Cash' : '📱 UPI'}
          </span>
        </td>
        <td class="font-mono text-muted" style="font-size:0.78rem;">${formatTime(s.timestamp)}</td>
        <td>
          <button class="btn btn-ghost btn-sm btn-icon" onclick="MilkApp.deleteSaleConfirm('${s.id}')" title="Delete">🗑️</button>
        </td>
      </tr>
    `).join('');
  }

  function addSale(date, paymentMode, quantity, amount, customer, notes) {
    if (isDayLocked(date)) {
      toast('error', 'Day Locked', 'Cannot add sales for a closed day');
      return false;
    }

    const currentStock = dbGet(DB_KEYS.currentStock) || 0;
    if (Number(quantity) > currentStock) {
      toast('error', 'Insufficient Stock', `Only ${formatQty(currentStock)} available. Cannot sell ${formatQty(quantity)}.`);
      return false;
    }

    const sale = {
      id: generateId(),
      date,
      paymentMode,
      quantity: Number(quantity),
      amount: Number(amount),
      customer: customer || 'Walk-in',
      notes: notes || '',
      paymentStatus: 'completed',
      gatewayTransactionId: null,
      timestamp: nowTimestamp(),
    };

    const sales = dbGetList(DB_KEYS.sales);
    sales.push(sale);
    dbSet(DB_KEYS.sales, sales);

    // Reduce stock
    const newStock = currentStock - Number(quantity);
    dbSet(DB_KEYS.currentStock, Math.max(0, newStock));

    const modeLabel = paymentMode === 'cash' ? '💵 Cash' : '📱 UPI';
    addActivity('sale', `Sold <strong>${formatQty(quantity)}</strong> for <strong>${formatCurrency(amount)}</strong> (${modeLabel})`);

    return true;
  }

  function deleteSaleConfirm(id) {
    const sales = dbGetList(DB_KEYS.sales);
    const sale = sales.find(s => s.id === id);
    if (!sale) return;

    if (isDayLocked(sale.date)) {
      toast('error', 'Day Locked', 'Cannot delete sales from a closed day');
      return;
    }

    showConfirm('🗑️', 'Delete Sale?', `Delete sale of ${formatQty(sale.quantity)} for ${formatCurrency(sale.amount)}?`, 'Delete', 'btn-danger', () => {
      const updated = dbGetList(DB_KEYS.sales).filter(s => s.id !== id);
      dbSet(DB_KEYS.sales, updated);

      // Restore stock
      const currentStock = (dbGet(DB_KEYS.currentStock) || 0) + sale.quantity;
      dbSet(DB_KEYS.currentStock, currentStock);

      toast('success', 'Sale Deleted', 'The sale has been removed and stock restored');
      addActivity('alert', `Deleted sale of <strong>${formatQty(sale.quantity)}</strong>`);
      refreshSales();
    });
  }

  function filterSales() {
    const filterDate = document.getElementById('salesFilterDate').value;
    if (!filterDate) {
      toast('warning', 'Select Date', 'Please select a date to filter');
      return;
    }
    const filtered = dbGetList(DB_KEYS.sales).filter(s => s.date === filterDate);
    renderSalesTable(filtered);
  }

  function clearSalesFilter() {
    document.getElementById('salesFilterDate').value = '';
    renderSalesTable(dbGetList(DB_KEYS.sales));
  }

  // =============== DAY CLOSING ===============
  function refreshClosing() {
    const today = todayStr();
    document.getElementById('closingDateBadge').textContent = formatDate(today);

    const todaySales = dbGetList(DB_KEYS.sales).filter(s => s.date === today);
    const todayStock = dbGetList(DB_KEYS.stockEntries).filter(s => s.date === today);
    const closings = dbGetList(DB_KEYS.closings);

    // Calculate opening stock: current stock + today sold - today purchased
    const currentStock = dbGet(DB_KEYS.currentStock) || 0;
    const todayPurchased = todayStock.reduce((sum, s) => sum + Number(s.quantity), 0);
    const todaySold = todaySales.reduce((sum, s) => sum + Number(s.quantity), 0);
    const openingStock = currentStock - todayPurchased + todaySold;

    const cashRevenue = todaySales.filter(s => s.paymentMode === 'cash').reduce((sum, s) => sum + Number(s.amount), 0);
    const upiRevenue = todaySales.filter(s => s.paymentMode === 'upi').reduce((sum, s) => sum + Number(s.amount), 0);
    const totalRevenue = cashRevenue + upiRevenue;
    const totalExpenses = todayStock.reduce((sum, s) => sum + Number(s.cost), 0);
    const netProfit = totalRevenue - totalExpenses;

    document.getElementById('closingOpenStock').textContent = formatQty(openingStock);
    document.getElementById('closingPurchased').textContent = formatQty(todayPurchased);
    document.getElementById('closingSold').textContent = formatQty(todaySold);
    document.getElementById('closingStock').textContent = formatQty(currentStock);
    document.getElementById('closingCash').textContent = formatCurrency(cashRevenue);
    document.getElementById('closingUpi').textContent = formatCurrency(upiRevenue);
    document.getElementById('closingExpenses').textContent = formatCurrency(totalExpenses);
    document.getElementById('closingProfit').textContent = formatCurrency(netProfit);

    // Day already closed?
    const alreadyClosed = isDayLocked(today);
    const closeDayBtn = document.getElementById('closeDayBtn');
    if (alreadyClosed) {
      closeDayBtn.disabled = true;
      closeDayBtn.textContent = '✅ Day Already Closed';
      closeDayBtn.className = 'btn btn-ghost btn-lg';
    } else {
      closeDayBtn.disabled = false;
      closeDayBtn.textContent = '🔒 Close Day & Lock Records';
      closeDayBtn.className = 'btn btn-warning btn-lg';
    }

    // Render closing history
    renderClosingHistory(closings);
  }

  function renderClosingHistory(closings) {
    const tbody = document.getElementById('closingHistoryBody');
    const empty = document.getElementById('closingHistoryEmpty');

    if (closings.length === 0) {
      tbody.innerHTML = '';
      empty.style.display = '';
      return;
    }

    empty.style.display = 'none';
    const sorted = [...closings].sort((a, b) => b.date.localeCompare(a.date));

    tbody.innerHTML = sorted.map(c => `
      <tr>
        <td class="fw-bold">${formatDate(c.date)}</td>
        <td>${formatQty(c.openingStock)}</td>
        <td class="text-primary">${formatQty(c.purchased)}</td>
        <td class="text-danger">${formatQty(c.sold)}</td>
        <td class="fw-bold">${formatQty(c.closingStock)}</td>
        <td class="text-success fw-bold">${formatCurrency(c.totalRevenue)}</td>
        <td class="text-danger">${formatCurrency(c.expenses)}</td>
        <td class="fw-bold ${c.netProfit >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(c.netProfit)}</td>
      </tr>
    `).join('');
  }

  function confirmCloseDay() {
    if (currentUser.role !== 'owner') {
      toast('error', 'Access Denied', 'Only the owner can close the day');
      return;
    }

    if (isDayLocked()) {
      toast('warning', 'Already Closed', 'Today has already been closed');
      return;
    }

    showConfirm('🔒', 'Close Day?', 'This will lock all records for today. No further entries can be made. This cannot be undone.', '🔒 Close Day', 'btn-warning', () => {
      closeDay();
    });
  }

  function closeDay() {
    const today = todayStr();
    const todaySales = dbGetList(DB_KEYS.sales).filter(s => s.date === today);
    const todayStock = dbGetList(DB_KEYS.stockEntries).filter(s => s.date === today);
    const currentStock = dbGet(DB_KEYS.currentStock) || 0;

    const todayPurchased = todayStock.reduce((sum, s) => sum + Number(s.quantity), 0);
    const todaySold = todaySales.reduce((sum, s) => sum + Number(s.quantity), 0);
    const openingStock = currentStock - todayPurchased + todaySold;

    const cashRevenue = todaySales.filter(s => s.paymentMode === 'cash').reduce((sum, s) => sum + Number(s.amount), 0);
    const upiRevenue = todaySales.filter(s => s.paymentMode === 'upi').reduce((sum, s) => sum + Number(s.amount), 0);
    const totalRevenue = cashRevenue + upiRevenue;
    const expenses = todayStock.reduce((sum, s) => sum + Number(s.cost), 0);

    const closing = {
      id: generateId(),
      date: today,
      openingStock,
      purchased: todayPurchased,
      sold: todaySold,
      closingStock: currentStock,
      cashRevenue,
      upiRevenue,
      totalRevenue,
      expenses,
      netProfit: totalRevenue - expenses,
      closedBy: currentUser.username,
      closedAt: nowTimestamp(),
    };

    const closings = dbGetList(DB_KEYS.closings);
    closings.push(closing);
    dbSet(DB_KEYS.closings, closings);

    addActivity('closing', `<strong>Day closed</strong> — Revenue: ${formatCurrency(totalRevenue)}, Profit: ${formatCurrency(totalRevenue - expenses)}`);

    toast('success', 'Day Closed!', `All records for ${formatDate(today)} have been locked.`);
    refreshClosing();
    checkDayLocked();
  }

  // =============== BACKUP ===============
  function generateBackup() {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const filename = `MilkShop_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.json`;

    const backupData = {
      version: '1.0',
      generatedAt: nowTimestamp(),
      shopSettings: dbGet(DB_KEYS.settings),
      suppliers: dbGetList(DB_KEYS.suppliers),
      stockEntries: dbGetList(DB_KEYS.stockEntries),
      storageLogs: dbGetList(DB_KEYS.storageLogs),
      sales: dbGetList(DB_KEYS.sales),
      closings: dbGetList(DB_KEYS.closings),
      currentStock: dbGet(DB_KEYS.currentStock),
      activities: dbGetList(DB_KEYS.activities),
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Log backup
    const logs = dbGetList(DB_KEYS.backupLog);
    logs.unshift({ filename, timestamp: nowTimestamp(), type: 'export' });
    dbSet(DB_KEYS.backupLog, logs);

    addActivity('closing', `Backup generated: <strong>${filename}</strong>`);
    toast('success', 'Backup Created', `File saved as ${filename}`);
    refreshBackupLog();
  }

  function restoreBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    showConfirm('⚠️', 'Restore Backup?', 'This will replace ALL current data with the backup data. Make sure you have a current backup first!', '📂 Restore', 'btn-warning', () => {
      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          const data = JSON.parse(e.target.result);
          if (!data.version || !data.suppliers) {
            toast('error', 'Invalid File', 'This does not appear to be a valid MilkFlow backup file');
            return;
          }

          dbSet(DB_KEYS.settings, data.shopSettings || {});
          dbSet(DB_KEYS.suppliers, data.suppliers || []);
          dbSet(DB_KEYS.stockEntries, data.stockEntries || []);
          dbSet(DB_KEYS.storageLogs, data.storageLogs || []);
          dbSet(DB_KEYS.sales, data.sales || []);
          dbSet(DB_KEYS.closings, data.closings || []);
          dbSet(DB_KEYS.currentStock, data.currentStock || 0);
          dbSet(DB_KEYS.activities, data.activities || []);

          // Log restore
          const logs = dbGetList(DB_KEYS.backupLog);
          logs.unshift({ filename: file.name, timestamp: nowTimestamp(), type: 'import' });
          dbSet(DB_KEYS.backupLog, logs);

          addActivity('alert', `Data restored from <strong>${file.name}</strong>`);
          toast('success', 'Data Restored!', `Successfully restored from ${file.name}`);
          navigate('dashboard');
        } catch (err) {
          toast('error', 'Restore Failed', 'Could not parse the backup file. Error: ' + err.message);
        }
      };
      reader.readAsText(file);
    });

    // Reset file input
    event.target.value = '';
  }

  function refreshBackupLog() {
    const logs = dbGetList(DB_KEYS.backupLog);
    const container = document.getElementById('backupLog');

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px 0;">
          <div class="empty-icon">📋</div>
          <h4>No backups generated yet</h4>
          <p>Your backup history will appear here</p>
        </div>`;
      return;
    }

    container.innerHTML = logs.slice(0, 20).map(log => `
      <div class="activity-item" style="padding:10px 0;">
        <span class="activity-dot ${log.type === 'export' ? 'closing' : 'alert'}"></span>
        <div style="flex:1;">
          <div class="fw-bold" style="font-size:0.85rem;">${escHtml(log.filename)}</div>
          <div class="text-muted" style="font-size:0.75rem;">${formatDate(log.timestamp)} at ${formatTime(log.timestamp)}</div>
        </div>
        <span class="badge ${log.type === 'export' ? 'badge-accent' : 'badge-warning'}">
          ${log.type === 'export' ? '📥 Export' : '📤 Import'}
        </span>
      </div>
    `).join('');
  }

  // =============== SETTINGS ===============
  function loadSettings() {
    const settings = dbGet(DB_KEYS.settings) || {};
    document.getElementById('shopName').value = settings.shopName || '';
    document.getElementById('shopAddress').value = settings.shopAddress || '';
    document.getElementById('shopPhone').value = settings.shopPhone || '';
    document.getElementById('defaultPrice').value = settings.defaultPrice || '';
    renderUsersTable();
    renderAuditLog();
  }

  function renderAuditLog() {
    const logs = MilkSecurity.getAuditLogs().slice(0, 20);
    const container = document.getElementById('auditLogList');
    if (!container) return;

    if (logs.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding:24px 0;">
          <div class="empty-icon">🛡️</div>
          <h4>No security events</h4>
          <p>Login attempts and security events will appear here</p>
        </div>`;
      return;
    }

    const iconMap = {
      'LOGIN_SUCCESS': { icon: '✅', cls: 'login-success' },
      'LOGIN_FAILED': { icon: '❌', cls: 'login-fail' },
      'LOGOUT': { icon: '🚪', cls: 'action' },
      'SESSION_EXPIRED': { icon: '⏰', cls: 'login-fail' },
      'USER_ADDED': { icon: '👤', cls: 'action' },
      'USER_UPDATED': { icon: '✏️', cls: 'action' },
      'USER_DELETED': { icon: '🗑️', cls: 'login-fail' },
      'PASSWORD_MIGRATION': { icon: '🔒', cls: 'action' },
      'DATA_CLEARED': { icon: '⚠️', cls: 'login-fail' },
    };

    container.innerHTML = logs.map(log => {
      const info = iconMap[log.action] || { icon: '🛡️', cls: 'action' };
      return `
        <div class="audit-item">
          <div class="audit-icon ${info.cls}">${info.icon}</div>
          <div class="audit-details">
            <div class="audit-action">${escHtml(log.action)}</div>
            <div class="audit-meta">${escHtml(log.details)} • ${escHtml(log.username)} • ${formatTime(log.timestamp)}</div>
          </div>
        </div>`;
    }).join('');
  }

  function saveSettings(shopName, shopAddress, shopPhone, defaultPrice) {
    const settings = dbGet(DB_KEYS.settings) || {};
    settings.shopName = shopName;
    settings.shopAddress = shopAddress;
    settings.shopPhone = shopPhone;
    settings.defaultPrice = Number(defaultPrice) || 50;
    dbSet(DB_KEYS.settings, settings);
    toast('success', 'Settings Saved', 'Shop settings have been updated');
    addActivity('closing', 'Updated shop settings');
  }

  async function changePassword(newPass, confirmPass) {
    const validation = MilkSecurity.validatePassword(newPass);
    if (!validation.valid) {
      toast('error', 'Weak Password', validation.issues.join('. '));
      return false;
    }
    if (newPass !== confirmPass) {
      toast('error', 'Validation Error', 'Passwords do not match');
      return false;
    }
    const users = dbGetList(DB_KEYS.users);
    const user = users.find(u => u.username === currentUser.username);
    if (user) {
      const hashResult = await MilkSecurity.hashPassword(newPass);
      user.passwordHash = hashResult.hash;
      user.salt = hashResult.salt;
      delete user.password;
      dbSet(DB_KEYS.users, users);
      MilkSecurity.auditLog('PASSWORD_CHANGED', 'User changed their password', currentUser.username);
      toast('success', 'Password Updated', 'Your password has been changed');
      return true;
    }
    return false;
  }

  // =============== USER MANAGEMENT ===============
  function renderUsersTable() {
    const users = dbGetList(DB_KEYS.users);
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;

    tbody.innerHTML = users.map((u, idx) => {
      const isCurrent = currentUser && u.username === currentUser.username && u.role === currentUser.role;
      return `
        <tr>
          <td>
            <div class="fw-bold">${escHtml(u.name)}</div>
            ${isCurrent ? '<span class="badge badge-accent" style="margin-top:4px;">You</span>' : ''}
          </td>
          <td class="font-mono" style="font-size:0.88rem;">${escHtml(u.username)}</td>
          <td>
            <span class="password-masked">••••••••</span>
            <span class="badge badge-success" style="margin-left:8px;">Hashed</span>
          </td>
          <td>
            <span class="badge ${u.role === 'owner' ? 'badge-warning' : 'badge-primary'}">
              ${u.role === 'owner' ? '👑 Owner' : '👤 Staff'}
            </span>
          </td>
          <td>
            <div class="flex gap-sm">
              <button class="btn btn-ghost btn-sm btn-icon" onclick="MilkApp.showUserModal(${idx})" title="Edit">✏️</button>
              <button class="btn btn-ghost btn-sm btn-icon" onclick="MilkApp.deleteUserConfirm(${idx})" title="Delete">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // Removed togglePasswordView — passwords are no longer visible

  function showUserModal(editIndex) {
    const form = document.getElementById('userForm');
    form.reset();
    document.getElementById('editUserIndex').value = '';

    if (editIndex !== undefined && editIndex !== null) {
      const users = dbGetList(DB_KEYS.users);
      const user = users[editIndex];
      if (user) {
        document.getElementById('userModalTitle').textContent = 'Edit User';
        document.getElementById('editUserIndex').value = String(editIndex);
        document.getElementById('userDisplayName').value = user.name;
        document.getElementById('userUsername').value = user.username;
        document.getElementById('userPassword').value = ''; // Can't prefill hashed password
        document.getElementById('userPassword').placeholder = 'Enter new password (required)';
        document.getElementById('userRoleSelect').value = user.role;
      }
    } else {
      document.getElementById('userModalTitle').textContent = 'Add New User';
    }
    openModal('userModal');
  }

  async function saveUser() {
    const displayName = MilkSecurity.sanitizeInput(document.getElementById('userDisplayName').value.trim());
    const username = document.getElementById('userUsername').value.trim();
    const password = document.getElementById('userPassword').value;
    const role = document.getElementById('userRoleSelect').value;
    const editIndexStr = document.getElementById('editUserIndex').value;
    const editIndex = editIndexStr !== '' ? Number(editIndexStr) : -1;

    if (!displayName || !username || !password) {
      toast('error', 'Validation Error', 'All fields are required');
      return;
    }

    // Validate username
    const usernameValidation = MilkSecurity.validateUsername(username);
    if (!usernameValidation.valid) {
      toast('error', 'Invalid Username', usernameValidation.message);
      return;
    }

    // Validate password strength
    const passwordValidation = MilkSecurity.validatePassword(password);
    if (!passwordValidation.valid) {
      toast('error', 'Weak Password', passwordValidation.issues.join('. '));
      return;
    }

    const users = dbGetList(DB_KEYS.users);

    // Check duplicate username
    const duplicate = users.find((u, i) => u.username === username && u.role === role && i !== editIndex);
    if (duplicate) {
      toast('error', 'Duplicate', `A ${role} with username "${username}" already exists`);
      return;
    }

    // Hash the password
    const hashResult = await MilkSecurity.hashPassword(password);

    if (editIndex >= 0 && editIndex < users.length) {
      const oldUser = users[editIndex];
      users[editIndex] = {
        ...oldUser,
        name: displayName,
        username,
        passwordHash: hashResult.hash,
        salt: hashResult.salt,
        role,
      };
      delete users[editIndex].password; // Remove legacy field
      dbSet(DB_KEYS.users, users);

      if (currentUser && oldUser.username === currentUser.username && oldUser.role === currentUser.role) {
        currentUser.username = username;
        currentUser.name = displayName;
        currentUser.role = role;
        MilkSecurity.createSession(currentUser);
        updateUserInfo();
      }

      MilkSecurity.auditLog('USER_UPDATED', `Updated user: ${displayName}`, currentUser?.username);
      toast('success', 'User Updated', `${displayName}'s credentials have been updated`);
      addActivity('closing', `Updated user <strong>${escHtml(displayName)}</strong>`);
    } else {
      users.push({
        username,
        passwordHash: hashResult.hash,
        salt: hashResult.salt,
        role,
        name: displayName,
      });
      dbSet(DB_KEYS.users, users);
      MilkSecurity.auditLog('USER_ADDED', `Added new user: ${displayName} (${role})`, currentUser?.username);
      toast('success', 'User Added', `${displayName} can now log in as ${role}`);
      addActivity('closing', `Added new user <strong>${escHtml(displayName)}</strong> (${role})`);
    }

    closeModal('userModal');
    renderUsersTable();
  }

  function deleteUserConfirm(index) {
    const users = dbGetList(DB_KEYS.users);
    if (index < 0 || index >= users.length) return;
    const user = users[index];

    // Prevent deleting yourself
    if (currentUser && user.username === currentUser.username && user.role === currentUser.role) {
      toast('error', 'Cannot Delete', 'You cannot delete the account you are currently logged into');
      return;
    }

    // Prevent deleting last owner
    if (user.role === 'owner') {
      const ownerCount = users.filter(u => u.role === 'owner').length;
      if (ownerCount <= 1) {
        toast('error', 'Cannot Delete', 'You must have at least one owner account');
        return;
      }
    }

    showConfirm('🗑️', 'Delete User?', `Are you sure you want to delete "${user.name}" (${user.username})? They will no longer be able to log in.`,
      'Delete User', 'btn-danger', () => {
        const updated = dbGetList(DB_KEYS.users);
        updated.splice(index, 1);
        dbSet(DB_KEYS.users, updated);
        MilkSecurity.auditLog('USER_DELETED', `Deleted user: ${user.name} (${user.username})`, currentUser?.username);
        toast('success', 'User Deleted', `${user.name} has been removed`);
        addActivity('alert', `Deleted user <strong>${escHtml(user.name)}</strong>`);
        renderUsersTable();
      });
  }

  // =============== CLEAR DATA ===============
  function confirmClearData() {
    if (currentUser.role !== 'owner') {
      toast('error', 'Access Denied', 'Only the owner can clear data');
      return;
    }
    showConfirm('💣', 'Clear ALL Data?', 'This will permanently delete ALL your data including suppliers, stock, sales, and closings. This CANNOT be undone!',
      '🗑️ Clear Everything', 'btn-danger', () => {
        Object.values(DB_KEYS).forEach(key => {
          if (key !== DB_KEYS.users && key !== DB_KEYS.session) {
            localStorage.removeItem(key);
          }
        });
        initDefaults();
        toast('success', 'Data Cleared', 'All data has been permanently removed');
        navigate('dashboard');
      });
  }

  // =============== HELPERS ===============
  function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // =============== SIDEBAR MOBILE ===============
  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('active');
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('active');
  }

  // =============== EVENT BINDINGS ===============
  document.addEventListener('DOMContentLoaded', () => {
    init();

    // Login form
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = MilkSecurity.sanitizeInput(document.getElementById('loginUser').value.trim());
      const pass = document.getElementById('loginPass').value;
      const role = document.getElementById('loginRole').value;
      const result = await login(user, pass, role);
      if (!result) {
        document.getElementById('loginError').classList.add('show');
        setTimeout(() => document.getElementById('loginError').classList.remove('show'), 3000);
      }
    });

    // Password toggle buttons
    const loginPassToggle = document.getElementById('loginPassToggle');
    if (loginPassToggle) {
      loginPassToggle.addEventListener('click', () => {
        const passInput = document.getElementById('loginPass');
        passInput.type = passInput.type === 'password' ? 'text' : 'password';
        loginPassToggle.textContent = passInput.type === 'password' ? '👁️' : '🙈';
      });
    }

    const userPassToggle = document.getElementById('userPassToggle');
    if (userPassToggle) {
      userPassToggle.addEventListener('click', () => {
        const passInput = document.getElementById('userPassword');
        passInput.type = passInput.type === 'password' ? 'text' : 'password';
        userPassToggle.textContent = passInput.type === 'password' ? '👁️' : '🙈';
      });
    }

    // Password strength meter
    const userPasswordInput = document.getElementById('userPassword');
    if (userPasswordInput) {
      userPasswordInput.addEventListener('input', () => {
        const strength = MilkSecurity.getPasswordStrength(userPasswordInput.value);
        const fill = document.getElementById('strengthFill');
        const text = document.getElementById('passwordStrengthText');
        if (fill) {
          fill.style.width = (strength.level * 25) + '%';
          fill.style.background = strength.color;
        }
        if (text) {
          text.textContent = userPasswordInput.value ? `Strength: ${strength.label}` : '';
          text.style.color = strength.color;
        }
      });
    }

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        navigate(item.dataset.page);
      });
    });

    // Mobile menu
    document.getElementById('mobileMenuBtn').addEventListener('click', toggleSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);

    // Logout
    document.getElementById('logoutBtn').addEventListener('click', () => {
      showConfirm('🚪', 'Logout?', 'Are you sure you want to logout?', 'Logout', 'btn-danger', logout);
    });

    // Confirm action
    document.getElementById('confirmActionBtn').addEventListener('click', executeConfirm);

    // Add Supplier button
    document.getElementById('addSupplierBtn').addEventListener('click', () => showSupplierModal());

    // Stock form
    document.getElementById('stockForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const date = document.getElementById('stockDate').value;
      const supplierId = document.getElementById('stockSupplier').value;
      const qty = document.getElementById('stockQty').value;
      const cost = document.getElementById('stockCost').value;
      const notes = document.getElementById('stockNotes').value;

      if (!supplierId) {
        toast('error', 'Select Supplier', 'Please select a supplier');
        return;
      }

      if (addStockEntry(date, supplierId, qty, cost, notes)) {
        toast('success', 'Stock Added', `${formatQty(qty)} of milk has been added to stock`);
        document.getElementById('stockForm').reset();
        document.getElementById('stockDate').value = todayStr();
        refreshStock();
      }
    });

    // Storage form
    document.getElementById('storageForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const date = document.getElementById('storageDate').value;
      const qty = document.getElementById('storageQty').value;
      const notes = document.getElementById('storageNotes').value;

      if (addStorageLog(date, qty, notes)) {
        toast('success', 'Storage Logged', `${formatQty(qty)} storage log has been recorded`);
        document.getElementById('storageForm').reset();
        document.getElementById('storageDate').value = todayStr();
        refreshStorage();
      }
    });

    // Sale form
    document.getElementById('saleForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const date = document.getElementById('saleDate').value;
      const mode = document.getElementById('saleMode').value;
      const qty = document.getElementById('saleQty').value;
      const amount = document.getElementById('saleAmount').value;
      const customer = document.getElementById('saleCustomer').value;
      const notes = document.getElementById('saleNotes').value;

      if (addSale(date, mode, qty, amount, customer, notes)) {
        toast('success', 'Sale Recorded', `${formatQty(qty)} sold for ${formatCurrency(amount)}`);
        document.getElementById('saleForm').reset();
        document.getElementById('saleDate').value = todayStr();
        refreshSales();
      }
    });

    // Sales tabs
    document.querySelectorAll('#pageSales .tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#pageSales .tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('#pageSales .tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const tabId = 'tab' + btn.dataset.tab.charAt(0).toUpperCase() + btn.dataset.tab.slice(1);
        document.getElementById(tabId).classList.add('active');
      });
    });

    // Settings form
    document.getElementById('settingsForm').addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings(
        document.getElementById('shopName').value.trim(),
        document.getElementById('shopAddress').value.trim(),
        document.getElementById('shopPhone').value.trim(),
        document.getElementById('defaultPrice').value
      );
    });

    // Notification button hint
    document.getElementById('notifBtn').addEventListener('click', () => {
      toast('info', 'Notifications', 'No new notifications at this time');
      document.getElementById('notifDot').style.display = 'none';
    });
  });

  // =============== PUBLIC API ===============
  return {
    navigate,
    showSupplierModal,
    saveSupplier,
    editSupplier,
    toggleSupplierStatus,
    deleteSupplierConfirm,
    deleteSaleConfirm,
    filterSales,
    clearSalesFilter,
    confirmCloseDay,
    generateBackup,
    restoreBackup,
    confirmClearData,
    closeModal,
    closeConfirm,
    showUserModal,
    saveUser,
    deleteUserConfirm,
    togglePasswordView: () => { },  // Deprecated — passwords are no longer viewable
  };
})();
