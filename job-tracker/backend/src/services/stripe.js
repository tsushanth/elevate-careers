const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('./db');

class StripeService {
  constructor() {
    this.stripe = stripe;
  }

  // Create Stripe customer for user
  async createCustomer(userId, email) {
    try {
      const customer = await this.stripe.customers.create({
        email,
        metadata: { userId }
      });

      // Save customer ID
      await pool.query(
        `INSERT INTO user_subscriptions (user_id, stripe_customer_id, status)
         VALUES ($1, $2, 'trialing')
         ON CONFLICT (stripe_customer_id) DO NOTHING`,
        [userId, customer.id]
      );

      return customer;
    } catch (error) {
      console.error('Failed to create Stripe customer:', error);
      throw error;
    }
  }

  // Create checkout session for subscription
  async createCheckoutSession(userId, email, priceId, successUrl, cancelUrl) {
    try {
      // Get or create customer
      let customer;
      const existingCustomer = await pool.query(
        'SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = $1',
        [userId]
      );

      if (existingCustomer.rows[0]?.stripe_customer_id) {
        customer = { id: existingCustomer.rows[0].stripe_customer_id };
      } else {
        customer = await this.createCustomer(userId, email);
      }

      // Create checkout session with 15-day trial
      const session = await this.stripe.checkout.sessions.create({
        customer: customer.id,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: 15,
          metadata: { userId }
        },
        success_url: successUrl,
        cancel_url: cancelUrl,
      });

      return session;
    } catch (error) {
      console.error('Failed to create checkout session:', error);
      throw error;
    }
  }

  // Create customer portal session
  async createPortalSession(customerId, returnUrl) {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      return session;
    } catch (error) {
      console.error('Failed to create portal session:', error);
      throw error;
    }
  }

  // Get subscription status
  async getSubscriptionStatus(userId) {
    try {
      const result = await pool.query(
        'SELECT * FROM check_user_subscription($1)',
        [userId]
      );

      if (result.rows.length === 0) {
        // First time user - start trial
        return {
          isActive: true,
          isTrial: true,
          trialDaysLeft: 15,
          status: 'trialing'
        };
      }

      const row = result.rows[0];
      return {
        isActive: row.is_active,
        isTrial: row.is_trial,
        trialDaysLeft: row.trial_days_left,
        status: row.status
      };
    } catch (error) {
      console.error('Failed to get subscription status:', error);
      throw error;
    }
  }

  // Handle webhook events
  async handleWebhook(event) {
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await this.handleCheckoutComplete(event.data.object);
          break;

        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await this.handleSubscriptionUpdate(event.data.object);
          break;

        case 'customer.subscription.deleted':
          await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          await this.handlePaymentSuccess(event.data.object);
          break;

        case 'invoice.payment_failed':
          await this.handlePaymentFailed(event.data.object);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }
    } catch (error) {
      console.error('Webhook handling error:', error);
      throw error;
    }
  }

  async handleCheckoutComplete(session) {
    const customerId = session.customer;
    const subscriptionId = session.subscription;

    // Get subscription details
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    
    await this.updateSubscription(subscription);
  }

  async handleSubscriptionUpdate(subscription) {
    await this.updateSubscription(subscription);
  }

  async updateSubscription(subscription) {
    const customerId = subscription.customer;
    
    // Get user ID from customer
    const userResult = await pool.query(
      'SELECT user_id FROM user_subscriptions WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) {
      console.error('User not found for customer:', customerId);
      return;
    }

    const userId = userResult.rows[0].user_id;

    // Update subscription
    await pool.query(
      `UPDATE user_subscriptions SET
        stripe_subscription_id = $1,
        status = $2,
        trial_start = $3,
        trial_end = $4,
        current_period_start = $5,
        current_period_end = $6,
        cancel_at_period_end = $7,
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $8`,
      [
        subscription.id,
        subscription.status,
        subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
        subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
        new Date(subscription.current_period_start * 1000),
        new Date(subscription.current_period_end * 1000),
        subscription.cancel_at_period_end,
        userId
      ]
    );
  }

  async handleSubscriptionDeleted(subscription) {
    await pool.query(
      `UPDATE user_subscriptions SET
        status = 'canceled',
        canceled_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
       WHERE stripe_subscription_id = $1`,
      [subscription.id]
    );
  }

  async handlePaymentSuccess(invoice) {
    const customerId = invoice.customer;
    
    // Get user ID
    const userResult = await pool.query(
      'SELECT user_id FROM user_subscriptions WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) return;

    const userId = userResult.rows[0].user_id;

    // Record payment
    await pool.query(
      `INSERT INTO payment_history 
       (user_id, stripe_payment_id, amount, currency, status, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        invoice.payment_intent,
        invoice.amount_paid,
        invoice.currency,
        'succeeded',
        invoice.description || 'Subscription payment'
      ]
    );
  }

  async handlePaymentFailed(invoice) {
    const customerId = invoice.customer;
    
    // Get user ID
    const userResult = await pool.query(
      'SELECT user_id FROM user_subscriptions WHERE stripe_customer_id = $1',
      [customerId]
    );

    if (userResult.rows.length === 0) return;

    const userId = userResult.rows[0].user_id;

    // Update subscription status
    await pool.query(
      `UPDATE user_subscriptions SET
        status = 'past_due',
        updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $1`,
      [userId]
    );

    // Record failed payment
    await pool.query(
      `INSERT INTO payment_history 
       (user_id, stripe_payment_id, amount, currency, status, description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        invoice.payment_intent,
        invoice.amount_due,
        invoice.currency,
        'failed',
        invoice.description || 'Subscription payment failed'
      ]
    );
  }
}

module.exports = new StripeService();