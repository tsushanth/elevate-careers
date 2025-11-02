const { ipcRenderer, shell } = require('electron');

// State
let currentUser = null;
let currentView = 'jobs';
let allSearches = []; // Store all searches for filter dropdown

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
    // NEW: Search source filter
    document.getElementById('search-filter').addEventListener('change', loadJobs);
    
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

// Screen management
function showLoginScreen() {
    document.getElementById('login-screen').style.display = 'block';
    document.getElementById('main-screen').style.display = 'none';
}

function showMainScreen() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('main-screen').style.display = 'block';
    document.getElementById('user-email').textContent = currentUser.email;
    
    // Load initial data
    loadJobs();
    loadSearches();
    loadScraperStatus();
    loadSubscriptionStatus();
}

function switchView(view) {
    // Update nav
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.view === view);
    });

    // Update content
    document.querySelectorAll('.view').forEach(v => {
        v.classList.toggle('active', v.id === `${view}-view`);
    });

    currentView = view;

    // Load view data
    if (view === 'jobs') {
        loadJobs();
    } else if (view === 'searches') {
        loadSearches();
    } else if (view === 'settings') {
        loadScraperStatus();
        loadSubscriptionStatus();
    }
}

// Jobs
async function loadJobs() {
    const jobsList = document.getElementById('jobs-list');
    jobsList.innerHTML = '<div class="loading">Loading jobs...</div>';
    
    const status = document.getElementById('status-filter').value;
    const searchId = document.getElementById('search-filter').value;
    
    const params = {};
    if (status) params.status = status;
    if (searchId) params.searchId = searchId; // NEW: Filter by search
    
    const result = await ipcRenderer.invoke('jobs:getAll', params);
    
    if (result.success && result.jobs) {
        if (result.jobs.length === 0) {
            jobsList.innerHTML = '<div class="loading">No jobs found</div>';
            return;
        }
        
        jobsList.innerHTML = result.jobs.map(job => {
            // NEW: Find the search URL for this job
            const search = allSearches.find(s => s.id === job.searchId);
            const searchInfo = search ? `<br><small class="search-source">From: <a href="#" onclick="filterBySearch('${job.searchId}'); return false;">${escapeHtml(search.queryUrl.substring(0, 60))}...</a></small>` : '';
            
            return `
            <div class="job-item" data-search-id="${job.searchId || ''}">
                <div class="job-info">
                    <div class="job-title job-link" data-url="${job.url}">
                        ${escapeHtml(job.title)}
                    </div>
                    <div class="job-company">${escapeHtml(job.company || 'Unknown Company')}</div>
                    <div class="job-meta">
                        ${escapeHtml(job.location || '')} • ${escapeHtml(job.board)} • ${job.postedDate || ''}
                        <span class="badge badge-${job.status}">${job.status}</span>
                        ${searchInfo}
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
        `;
        }).join('');
    } else {
        jobsList.innerHTML = '<div class="loading">Failed to load jobs</div>';
    }
}

// NEW: Filter jobs by specific search
window.filterBySearch = function(searchId) {
    document.getElementById('search-filter').value = searchId;
    loadJobs();
};

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
        // Store searches globally for the filter
        allSearches = result.searches;
        
        // Update the search filter dropdown
        updateSearchFilter();
        
        if (result.searches.length === 0) {
            searchesList.innerHTML = '<div class="loading">No searches configured. Click "Add Search" to get started.</div>';
            return;
        }
        
        searchesList.innerHTML = result.searches.map(search => `
            <div class="search-item">
                <div class="search-info">
                    <h3>${search.board.toUpperCase()} - Search #${search.id}</h3>
                    <p><strong>URL:</strong> ${escapeHtml(search.queryUrl)}</p>
                    <p><strong>Interval:</strong> ${search.interval} minutes</p>
                    <p><strong>Status:</strong> ${search.active ? '✅ Active' : '❌ Inactive'}</p>
                    <p><strong>Last scraped:</strong> ${search.lastScrapedAt ? new Date(search.lastScrapedAt).toLocaleString() : 'Never'}</p>
                </div>
                <div class="search-actions">
                    <button class="btn-secondary btn-small" onclick="filterBySearch('${search.id}')">View Jobs</button>
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

// NEW: Update the search filter dropdown
function updateSearchFilter() {
    const searchFilter = document.getElementById('search-filter');
    
    // Clear existing options except "All Searches"
    searchFilter.innerHTML = '<option value="">All Searches</option>';
    
    // Add option for each search
    allSearches.forEach(search => {
        const option = document.createElement('option');
        option.value = search.id;
        const urlPreview = search.queryUrl.length > 50 
            ? search.queryUrl.substring(0, 50) + '...' 
            : search.queryUrl;
        option.textContent = `${search.board.toUpperCase()} - ${urlPreview}`;
        searchFilter.appendChild(option);
    });
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
        showSearchError(result.error || 'Failed to create search');
    }
}

function showSearchError(message) {
    const errorDiv = document.getElementById('search-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

window.toggleSearch = async function(searchId, active) {
    await ipcRenderer.invoke('searches:update', { id: searchId, data: { active } });
    loadSearches();
};

window.deleteSearch = async function(searchId) {
    if (confirm('Are you sure you want to delete this search?')) {
        await ipcRenderer.invoke('searches:delete', searchId);
        loadSearches();
    }
};

// Settings
async function loadScraperStatus() {
    const status = await ipcRenderer.invoke('scraper:getStatus');
    
    document.getElementById('scraper-running').textContent = status.isRunning ? 'Running ✓' : 'Stopped';
    document.getElementById('scraper-last-run').textContent = status.lastRun ? new Date(status.lastRun).toLocaleString() : '-';
    document.getElementById('scraper-next-run').textContent = status.nextRun ? new Date(status.nextRun).toLocaleString() : '-';
}

async function handleRunScraperNow() {
    const button = document.getElementById('run-scraper-now');
    button.disabled = true;
    button.textContent = 'Running...';
    
    const result = await ipcRenderer.invoke('scraper:runNow');
    
    if (result.success) {
        button.textContent = 'Success!';
        setTimeout(() => {
            button.disabled = false;
            button.textContent = 'Run Now';
            loadScraperStatus();
        }, 2000);
    } else {
        button.textContent = 'Failed';
        alert('Failed to run scraper: ' + (result.error || 'Unknown error'));
        button.disabled = false;
        button.textContent = 'Run Now';
    }
}

async function loadSubscriptionStatus() {
    const statusDiv = document.getElementById('subscription-status');
    const manageBtn = document.getElementById('manage-subscription-btn');
    
    statusDiv.textContent = 'Loading...';
    
    try {
        const result = await ipcRenderer.invoke('subscription:getStatus');
        
        if (result.success && result.subscription) {
            const sub = result.subscription;
            
            if (sub.status === 'active') {
                statusDiv.innerHTML = `
                    <p><strong>Status:</strong> Active ✓</p>
                    <p><strong>Plan:</strong> ${sub.planName || 'Premium'}</p>
                    <p><strong>Renews:</strong> ${sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).toLocaleDateString() : 'N/A'}</p>
                `;
                manageBtn.style.display = 'inline-block';
            } else if (sub.status === 'trialing') {
                statusDiv.innerHTML = `
                    <p><strong>Status:</strong> Trial</p>
                    <p><strong>Trial ends:</strong> ${sub.trialEnd ? new Date(sub.trialEnd).toLocaleDateString() : 'N/A'}</p>
                `;
            } else {
                statusDiv.innerHTML = `<p><strong>Status:</strong> ${sub.status}</p>`;
            }
        } else {
            statusDiv.innerHTML = '<p>No active subscription</p>';
        }
    } catch (error) {
        console.error('Failed to load subscription status:', error);
        statusDiv.innerHTML = '<p>Failed to load subscription status</p>';
    }
}

// Subscription handlers
document.getElementById('manage-subscription-btn')?.addEventListener('click', async () => {
    await ipcRenderer.invoke('subscription:createPortal');
});

document.getElementById('upgrade-btn')?.addEventListener('click', async () => {
    // Show plans modal or redirect to pricing
    const result = await ipcRenderer.invoke('subscription:getPlans');
    if (result.success && result.plans && result.plans.length > 0) {
        // Create checkout with first plan
        await ipcRenderer.invoke('subscription:createCheckout', result.plans[0].stripe_price_id);
    }
});

// Utility
function escapeHtml(text) {
    if (!text) return '';
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