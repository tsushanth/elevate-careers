const express = require('express');
const router = express.Router();
const stripeService = require('../services/stripe');
const { authenticateToken } = require('../middleware/auth');

// Get subscription status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const status = await stripeService.getSubscriptionStatus(req.user.userId);
    res.json({ success: true, subscription: status });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({ success: false, error: 'Failed to get subscription status' });
  }
});

// Create checkout session
router.post('/create-checkout', authenticateToken, async (req, res) => {
  try {
    const { priceId } = req.body;
    
    if (!priceId) {
      return res.status(400).json({ success: false, error: 'Price ID required' });
    }

    const session = await stripeService.createCheckoutSession(
      req.user.userId,
      req.user.email,
      priceId,
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/subscription/success`,
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/subscription/cancel`
    );

    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Create checkout error:', error);
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

// Create customer portal session
router.post('/create-portal', authenticateToken, async (req, res) => {
  try {
    // Get customer ID
    const result = await stripeService.pool.query(
      'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].stripe_customer_id) {
      return res.status(404).json({ success: false, error: 'No subscription found' });
    }

    const session = await stripeService.createPortalSession(
      result.rows[0].stripe_customer_id,
      `${process.env.FRONTEND_URL || 'http://localhost:3000'}/settings`
    );

    res.json({ success: true, url: session.url });
  } catch (error) {
    console.error('Create portal error:', error);
    res.status(500).json({ success: false, error: 'Failed to create portal session' });
  }
});

// Get subscription plans
router.get('/plans', async (req, res) => {
  try {
    const { pool } = require('../services/db');
    const result = await pool.query(
      'SELECT * FROM subscription_plans WHERE active = true ORDER BY amount ASC'
    );
    res.json({ success: true, plans: result.rows });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ success: false, error: 'Failed to get plans' });
  }
});

// Stripe webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  try {
    const event = stripeService.stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    await stripeService.handleWebhook(event);
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
});

module.exports = router;