const axios = require('axios');

class ApiService {
  constructor(store) {
    this.store = store;
    this.baseURL = process.env.API_URL || 'https://job-tracker-api-3t2vweivqa-uc.a.run.app/api';
    
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Add auth token to requests
    this.client.interceptors.request.use((config) => {
      const token = this.store.get('authToken');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  // Auth
  async register(credentials) {
    const response = await this.client.post('/auth/register', credentials);
    return response.data;
  }

  async login(credentials) {
    const response = await this.client.post('/auth/login', credentials);
    return response.data;
  }

  // Searches
  async getSearches() {
    const response = await this.client.get('/searches/mine');
    return response.data;
  }

  async createSearch(searchData) {
    const response = await this.client.post('/searches', searchData);
    return response.data;
  }

  async updateSearch(id, data) {
    const response = await this.client.patch(`/searches/${id}`, data);
    return response.data;
  }

  async deleteSearch(id) {
    const response = await this.client.delete(`/searches/${id}`);
    return response.data;
  }

  // Subscription
  async getSubscriptionStatus() {
    const response = await this.client.get('/subscription/status');
    return response.data;
  }
  
  async createCheckoutSession(priceId) {
    const response = await this.client.post('/subscription/create-checkout', {
      priceId
    });
    return response.data;
  }
  
  async createPortalSession() {
    const response = await this.client.post('/subscription/create-portal');
    return response.data;
  }

  // Jobs
  async getJobs(params = {}) {
    const response = await this.client.get('/jobs', { params });
    return response.data;
  }

  async submitJobBatch(data) {
    const response = await this.client.post('/jobs/batch', data);
    return response.data;
  }

  async updateJobStatus(id, status) {
    const response = await this.client.patch(`/jobs/${id}`, { status });
    return response.data;
  }

  // Plugins
  async getPluginManifest() {
    const response = await this.client.get('/plugins/manifest');
    return response.data;
  }

  async downloadPlugin(pluginName) {
    const response = await this.client.get(`/plugins/${pluginName}/download`);
    return response.data;
  }
}

module.exports = ApiService;