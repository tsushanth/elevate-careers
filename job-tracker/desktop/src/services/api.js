const axios = require('axios');
const config = require('../config');

class ApiService {
  constructor(store) {
    this.store = store;
    this.baseURL = config.API_URL;
    
    console.log('API Service initialized with URL:', this.baseURL);
    
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
    try {
      const response = await this.client.get('/plugins/manifest');
      return response.data;
    } catch (error) {
      console.error('Failed to get plugin manifest:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  async downloadPlugin(pluginName) {
    try {
      console.log(`Requesting plugin from API: ${pluginName}`);
      const response = await this.client.get(`/plugins/${pluginName}/download`);
      console.log(`Plugin ${pluginName} downloaded successfully`);
      return response.data;
    } catch (error) {
      console.error(`Failed to download plugin ${pluginName}:`, error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', error.response.data);
      }
      throw error;
    }
  }

  // Subscription
  async getSubscriptionStatus() {
    try {
      const response = await this.client.get('/subscription/status');
      return response.data;
    } catch (error) {
      console.error('Failed to get subscription status:', error.message);
      throw error;
    }
  }

  async getSubscriptionPlans() {
    try {
      const response = await this.client.get('/subscription/plans');
      return response.data;
    } catch (error) {
      console.error('Failed to get subscription plans:', error.message);
      throw error;
    }
  }

  async createCheckoutSession(priceId) {
    try {
      const response = await this.client.post('/subscription/create-checkout', { priceId });
      return response.data;
    } catch (error) {
      console.error('Failed to create checkout session:', error.message);
      throw error;
    }
  }

  async createPortalSession() {
    try {
      const response = await this.client.post('/subscription/create-portal');
      return response.data;
    } catch (error) {
      console.error('Failed to create portal session:', error.message);
      throw error;
    }
  }
}

module.exports = ApiService;