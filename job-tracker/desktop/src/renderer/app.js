const { ipcRenderer, shell } = require('electron');

// State
let currentUser = null;
let currentView = 'jobs';

// Initialize app
async function init() {
    // Check if user is logged in
    const { user, isAuthenticated } = await ipcRenderer.invoke('auth:getUser');
    
    if (isAuthenticated && user) {
        currentUser = user;
        showMainScreen();
    } else {
        showLoginScreen();
    }

    setupEventListeners();
}

function setupEventListeners() {
    // Auth
    document.getElementById('login-btn').addEventListener('click', handleLogin);
    document.getElementById('register-btn').addEventListener('click', handleRegister);
    document.getElementById('show-register').addEventListener('click', () => toggleAuthForm('register'));
    document.getElementById('show-login').addEventListener('click', () => toggleAuthForm('login'));
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            switchView(view);
        });
    });

    // Jobs
    document.getElementById('refresh-jobs').addEventListener('click', loadJobs);
    document.getElementById('status-filter').addEventListener('change', loadJobs);
    
    // Job links - use event delegation to open in external browser
    document.getElementById('jobs-list').addEventListener('click', (e) => {
        const jobLink = e.target.closest('.job-link');
        if (jobLink) {
            const url = jobLink.dataset.url;
            if (url) {
                shell.openExternal(url);
            }
        }
    });

    // Searches
    document.getElementById('add-search-btn').addEventListener('click', showAddSearchModal);
    document.getElementById('save-search-btn').addEventListener('click', handleAddSearch);
    document.getElementById('cancel-search-btn').addEventListener('click', hideAddSearchModal);

    // Settings
    document.getElementById('run-scraper-now').addEventListener('click', handleRunScraperNow);

    // Enter key handlers
    document.getElementById('login-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('register-password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleRegister();
    });
}

// Auth functions
function toggleAuthForm(form) {
    if (form === 'register') {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
    } else {
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('register-form').style.display = 'none';
    }
    document.getElementById('auth-error').style.display = 'none';
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }

    const result = await ipcRenderer.invoke('auth:login', { email, password });

    if (result.success) {
        currentUser = result.user;
        showMainScreen();
    } else {
        showAuthError(result.error || 'Login failed');
    }
}

async function handleRegister() {
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (!email || !password) {
        showAuthError('Please enter email and password');
        return;
    }

    if (password.length < 8) {
        showAuthError('Password must be at least 8 characters');
        return;
    }

    const result = await ipcRenderer.invoke('auth:register', { email, password });

    if (result.success) {
        currentUser = result.user;
        showMainScreen();
    } else {
        showAuthError(result.error || 'Registration failed');
    }
}

async function handleLogout() {
    await ipcRenderer.invoke('auth:logout');
    currentUser = null;
    showLoginScreen();
}

function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function showLoginScreen() {
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('main-screen').style.display = 'none';
}

function showMainScreen() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';
    document.getElementById('user-email').textContent = currentUser.email;
    
    // Load initial data
    switchView('jobs');
    loadScraperStatus();
    
    // Refresh scraper status every 30 seconds
    setInterval(loadScraperStatus, 30000);
}

// Navigation
function switchView(view) {
    currentView = view;
    
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    
    // Update views
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === `${view}-view`);
    });
    
    // Load data for view
    if (view === 'jobs') {
        loadJobs();
    } else if (view === 'searches') {
        loadSearches();
    } else if (view === 'settings') {
        loadScraperStatus();
    }
}

// Jobs
async function loadJobs() {
    const status = document.getElementById('status-filter').value;
    const jobsList = document.getElementById('jobs-list');
    
    jobsList.innerHTML = '<div class="loading">Loading jobs...</div>';
    
    const result = await ipcRenderer.invoke('jobs:getAll', { status, limit: 100 });
    
    if (result.success && result.jobs) {
        if (result.jobs.length === 0) {
            jobsList.innerHTML = '<div class="loading">No jobs found</div>';
            return;
        }
        
        jobsList.innerHTML = result.jobs.map(job => `
            <div class="job-item">
                <div class="job-info">
                    <div class="job-title job-link" data-url="${job.url}">
                        ${escapeHtml(job.title)}
                    </div>
                    <div class="job-company">${escapeHtml(job.company || 'Unknown Company')}</div>
                    <div class="job-meta">
                        ${escapeHtml(job.location || '')} • ${escapeHtml(job.board)} • ${job.postedDate || ''}
                        <span class="badge badge-${job.status}">${job.status}</span>
                    </div>
                </div>
                <div class="job-actions">
                    <select onchange="updateJobStatus('${job.id}', this.value)">
                        <option value="new" ${job.status === 'new' ? 'selected' : ''}>New</option>
                        <option value="seen" ${job.status === 'seen' ? 'selected' : ''}>Seen</option>
                        <option value="applied" ${job.status === 'applied' ? 'selected' : ''}>Applied</option>
                        <option value="rejected" ${job.status === 'rejected' ? 'selected' : ''}>Rejected</option>
                    </select>
                </div>
            </div>
        `).join('');
    } else {
        jobsList.innerHTML = '<div class="loading">Failed to load jobs</div>';
    }
}

async function updateJobStatus(jobId, status) {
    await ipcRenderer.invoke('jobs:updateStatus', { id: jobId, status });
    loadJobs(); // Reload to refresh
}

// Searches
async function loadSearches() {
    const searchesList = document.getElementById('searches-list');
    searchesList.innerHTML = '<div class="loading">Loading searches...</div>';
    
    const result = await ipcRenderer.invoke('searches:getAll');
    
    if (result.success && result.searches) {
        if (result.searches.length === 0) {
            searchesList.innerHTML = '<div class="loading">No searches configured. Click "Add Search" to get started.</div>';
            return;
        }
        
        searchesList.innerHTML = result.searches.map(search => `
            <div class="search-item">
                <div class="search-info">
                    <h3>${search.board.toUpperCase()}</h3>
                    <p>URL: ${escapeHtml(search.queryUrl)}</p>
                    <p>Interval: ${search.interval} minutes</p>
                    <p>Status: ${search.active ? '✅ Active' : '❌ Inactive'}</p>
                    <p>Last scraped: ${search.lastScrapedAt ? new Date(search.lastScrapedAt).toLocaleString() : 'Never'}</p>
                </div>
                <div class="search-actions">
                    <button class="btn-secondary btn-small" onclick="toggleSearch('${search.id}', ${!search.active})">
                        ${search.active ? 'Disable' : 'Enable'}
                    </button>
                    <button class="btn-secondary btn-small" onclick="deleteSearch('${search.id}')">Delete</button>
                </div>
            </div>
        `).join('');
    } else {
        searchesList.innerHTML = '<div class="loading">Failed to load searches</div>';
    }
}

function showAddSearchModal() {
    document.getElementById('add-search-modal').style.display = 'flex';
    document.getElementById('search-error').style.display = 'none';
}

function hideAddSearchModal() {
    document.getElementById('add-search-modal').style.display = 'none';
    document.getElementById('search-url').value = '';
    document.getElementById('search-interval').value = '30';
}

async function handleAddSearch() {
    const board = document.getElementById('search-board').value;
    const queryUrl = document.getElementById('search-url').value.trim();
    const interval = parseInt(document.getElementById('search-interval').value);
    
    if (!queryUrl) {
        showSearchError('Please enter a search URL');
        return;
    }
    
    if (interval < 30) {
        showSearchError('Interval must be at least 30 minutes');
        return;
    }
    
    const result = await ipcRenderer.invoke('searches:create', { board, queryUrl, interval });
    
    if (result.success) {
        hideAddSearchModal();
        loadSearches();
    } else {
        showSearchError(result.error || 'Failed to add search');
    }
}

async function toggleSearch(id, active) {
    await ipcRenderer.invoke('searches:update', { id, data: { active } });
    loadSearches();
}

async function deleteSearch(id) {
    if (!confirm('Are you sure you want to delete this search?')) {
        return;
    }
    await ipcRenderer.invoke('searches:delete', id);
    loadSearches();
}

function showSearchError(message) {
    const errorDiv = document.getElementById('search-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

// Settings
async function loadScraperStatus() {
    const status = await ipcRenderer.invoke('scraper:getStatus');
    
    document.getElementById('scraper-running').textContent = status.isRunning ? '🟢 Running' : '🔴 Stopped';
    document.getElementById('scraper-last-run').textContent = status.lastRun ? new Date(status.lastRun).toLocaleString() : 'Never';
    document.getElementById('scraper-next-run').textContent = status.nextRun ? new Date(status.nextRun).toLocaleString() : '-';
}

async function handleRunScraperNow() {
    const btn = document.getElementById('run-scraper-now');
    btn.disabled = true;
    btn.textContent = 'Running...';
    
    await ipcRenderer.invoke('scraper:runNow');
    
    btn.disabled = false;
    btn.textContent = 'Run Now';
    
    setTimeout(loadScraperStatus, 1000);
}

// Subscription Management
async function checkSubscription() {
  try {
    const response = await ipcRenderer.invoke('subscription:getStatus');
    
    if (!response || !response.success) {
      console.error('Failed to get subscription status');
      return;
    }
    
    const sub = response.subscription;
    const banner = document.getElementById('subscription-banner');
    const message = document.getElementById('trial-message');
    const statusEl = document.getElementById('subscription-status');
    const manageBtn = document.getElementById('manage-subscription-btn');
    
    // Update settings page
    if (sub.isTrial) {
      statusEl.textContent = `🎉 Free Trial Active - ${sub.trialDaysLeft} days remaining`;
      manageBtn.style.display = 'none';
    } else if (sub.isActive) {
      statusEl.textContent = `✅ Subscription Active`;
      manageBtn.style.display = 'inline-block';
    } else {
      statusEl.textContent = `❌ Subscription Inactive - Please upgrade`;
      manageBtn.style.display = 'none';
    }
    
    // Update banner
    banner.classList.remove('warning', 'expired');
    
    if (sub.isTrial) {
      banner.style.display = 'block';
      message.textContent = `🎉 Free trial: ${sub.trialDaysLeft} days remaining`;
      
      if (sub.trialDaysLeft <= 3) {
        banner.classList.add('warning');
        message.textContent = `⚠️ Trial ending soon: ${sub.trialDaysLeft} days left`;
      }
    } else if (!sub.isActive) {
      banner.style.display = 'block';
      banner.classList.add('expired');
      message.textContent = '❌ Trial expired - Upgrade to continue using Job Tracker';
      
      // Show upgrade reminder in settings
      statusEl.innerHTML = `❌ Trial expired - <a href="#" id="upgrade-link">Upgrade Now</a>`;
      document.getElementById('upgrade-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        handleUpgrade();
      });
    } else {
      banner.style.display = 'none';
    }
  } catch (error) {
    console.error('Subscription check error:', error);
  }
}

async function handleUpgrade() {
  try {
    // Get plans
    const plansResponse = await ipcRenderer.invoke('subscription:getPlans');
    
    if (!plansResponse || !plansResponse.success || !plansResponse.plans || plansResponse.plans.length === 0) {
      alert('Unable to load subscription plans. Please try again later.');
      return;
    }
    
    // Use the first plan (or you could show a selection)
    const plan = plansResponse.plans[0];
    
    console.log('Creating checkout for plan:', plan.stripe_price_id);
    
    const response = await ipcRenderer.invoke('subscription:createCheckout', plan.stripe_price_id);
    
    if (response.success) {
      console.log('Checkout session created, opening Stripe in browser...');
      // Browser will open automatically via IPC handler
    } else {
      const errorMsg = response.error || 'Unknown error';
      console.error('Checkout error:', errorMsg);
      
      if (errorMsg.includes('not configured')) {
        alert('Payment system is not yet configured. Please contact support or check back later.');
      } else {
        alert('Failed to create checkout session: ' + errorMsg);
      }
    }
  } catch (error) {
    console.error('Upgrade error:', error);
    alert('Error creating checkout session. Please try again or contact support.');
  }
}

async function handleManageSubscription() {
  try {
    const response = await ipcRenderer.invoke('subscription:createPortal');
    
    if (response.success) {
      console.log('Opening billing portal in browser...');
      // Browser will open automatically via IPC handler
    } else {
      alert('Failed to open billing portal: ' + (response.error || 'Unknown error'));
    }
  } catch (error) {
    console.error('Portal error:', error);
    alert('Error opening billing portal. Please try again.');
  }
}

// Setup subscription event listeners
function setupSubscriptionListeners() {
  const upgradeBtn = document.getElementById('upgrade-btn');
  const manageBtn = document.getElementById('manage-subscription-btn');
  
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', handleUpgrade);
  }
  
  if (manageBtn) {
    manageBtn.addEventListener('click', handleManageSubscription);
  }
  
  // Check subscription on app load and every hour
  checkSubscription();
  setInterval(checkSubscription, 3600000); // 1 hour
}

// Update setupEventListeners to include subscription
const originalSetupEventListeners = setupEventListeners;
setupEventListeners = function() {
  originalSetupEventListeners();
  setupSubscriptionListeners();
};

// Utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}