const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // to create and check login tokens
const { Resend } = require('resend');
const promClient = require('prom-client');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Prometheus metrics setup
// ---------------------------------------------------------------------------
const register = new promClient.Registry();
promClient.collectDefaultMetrics({ register }); 

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

const activeAuctions = new promClient.Gauge({
  name: 'auction_active_total',
  help: 'Number of currently active auctions',
  registers: [register],
});

// Middleware: record duration and count for every request
app.use((req, res, next) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const labels = { method: req.method, route, status_code: res.statusCode };
    httpRequestsTotal.inc(labels);
    end(labels);
  });
  next();
});
// ---------------------------------------------------------------------------

// Email client for bid notifications (uses HTTPS, no SMTP port needed)
const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'auctiondb',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'; // secret for signing JWT tokens

app.get('/health', (req, res) => {
  res.status(200).send('Auction API is healthy - CI/CD Automation Successful!');
});

  // Prometheus metrics endpoint — scraped by DigitalOcean / Prometheus
  app.get('/metrics', async (req, res) => {
    try {
      // Refresh active auction gauge on every scrape
      const result = await pool.query(
        "SELECT COUNT(*) FROM auctions WHERE status = 'active' AND end_time > NOW()"
      );
      activeAuctions.set(parseInt(result.rows[0].count, 10));
    } catch (_) {
      // DB unavailable — leave gauge at last known value
    }
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

function authenticate_token(req, res, next) {
  const auth_header = req.headers.authorization;

  if (!auth_header) {
    return res.status(401).json({ error: 'Authorization header is required' });
  }

  const token_parts = auth_header.split(' ');

  if (token_parts.length !== 2 || token_parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'Authorization format must be Bearer <token>' });
  }

  const token = token_parts[1];

  try {
    const decoded_user = jwt.verify(token, JWT_SECRET);
    req.user = decoded_user;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;

  if (!username || !password || !email) {
    return res.status(400).json({ error: 'Username, password and email are required' });
  }

  try {
    const existing_user = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existing_user.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const insert_user_result = await pool.query(
      `INSERT INTO users (username, password_hash, email)
       VALUES ($1, $2, $3)
       RETURNING id, username, email`,
      [username, password_hash, email]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: insert_user_result.rows[0],
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user_result = await pool.query(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (user_result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = user_result.rows[0];

    const password_matches = await bcrypt.compare(password, user.password_hash);
    if (!password_matches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/me', authenticate_token, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'SELECT id, username FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('Error getting current user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/users/me/auctions', authenticate_token, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `
        SELECT 
          a.id,
          a.title,
          a.description,
          a.starting_price,
          a.end_time,
          a.status,
          a.creator_id,
          a.winner_id,
          MAX(b.amount) AS highest_bid
        FROM auctions a
        LEFT JOIN bids b ON a.id = b.auction_id
        WHERE a.creator_id = $1
        GROUP BY a.id
        ORDER BY a.end_time ASC
      `,
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error getting user auctions:', error);
    res.status(500).json({ error:'Internal server error' });
  }
});

app.get('/api/users/me/bids', authenticate_token, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `
        SELECT
          b.id,
          b.amount,
          b.created_at,
          b.auction_id,
          a.title,
          a.status,
          a.end_time
        FROM bids b
        JOIN auctions a ON a.id = b.auction_id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
      `,
      [userId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error getting user bids:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auctions', authenticate_token, async (req, res) => {
  const { title, description, starting_price, end_time } = req.body;
  const creator_id = req.user.id; // get creator id from token

  if (!title || !starting_price || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const query = `
      INSERT INTO auctions (title, description, starting_price, end_time, creator_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const values = [title, description, starting_price, end_time, creator_id];
    const result = await pool.query(query, values);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating auction:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/auctions', async (req, res) => {
  const { status, search } = req.query;

  try {
    // Include the current highest bid (if any) for each auction
    let query = `
      SELECT a.*, b.highest_bid
      FROM auctions a
      LEFT JOIN (
        SELECT auction_id, MAX(amount) AS highest_bid
        FROM bids
        GROUP BY auction_id
      ) b ON a.id = b.auction_id
      WHERE 1=1
    `;

    const values = [];
    let counter = 1;

    if (search) {
      query += ` AND a.title ILIKE $${counter}`;
      values.push(`%${search}%`);
      counter++;
    }

    if (status === 'active') {
      query += " AND a.status = 'active' AND a.end_time > CURRENT_TIMESTAMP";
    } else if (status === 'completed') {
      query += " AND (a.status = 'completed' OR a.end_time <= CURRENT_TIMESTAMP)";
    }

    query += ' ORDER BY a.end_time ASC';

    const result = await pool.query(query, values);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching auctions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get a single auction (with highest bid + winner info)
app.get('/api/auctions/:id', async (req, res) => {
  const auctionId = parseInt(req.params.id, 10);

  if (Number.isNaN(auctionId)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }

  try {
    const result = await pool.query(
      `
        SELECT a.*, b.highest_bid,
               w.username AS winner_username, w.email AS winner_email
        FROM auctions a
        LEFT JOIN (
          SELECT auction_id, MAX(amount) AS highest_bid
          FROM bids
          GROUP BY auction_id
        ) b ON a.id = b.auction_id
        LEFT JOIN users w ON w.id = a.winner_id
        WHERE a.id = $1
      `,
      [auctionId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching auction:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Edit an auction (only by creator, only if active)
app.put('/api/auctions/:id', authenticate_token, async (req, res) => {
  const auctionId = parseInt(req.params.id, 10);
  const { title, description, starting_price, end_time } = req.body;

  if (Number.isNaN(auctionId)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }

  try {
    const auctionResult = await pool.query(
      'SELECT id, creator_id, status FROM auctions WHERE id = $1',
      [auctionId]
    );

    if (auctionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    const auction = auctionResult.rows[0];
    if (auction.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the auction creator can edit this auction' });
    }
    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'Only active auctions can be edited' });
    }

    // Check if there are existing bids (can't change starting_price if bids exist)
    const bidCheck = await pool.query('SELECT COUNT(*) FROM bids WHERE auction_id = $1', [auctionId]);
    const hasBids = parseInt(bidCheck.rows[0].count) > 0;

    if (hasBids && starting_price !== undefined) {
      return res.status(400).json({ error: 'Cannot change starting price when bids exist' });
    }

    const updates = [];
    const values = [];
    let idx = 1;

    if (title !== undefined) { updates.push(`title = $${idx++}`); values.push(title); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (starting_price !== undefined) { updates.push(`starting_price = $${idx++}`); values.push(starting_price); }
    if (end_time !== undefined) { updates.push(`end_time = $${idx++}`); values.push(end_time); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(auctionId);
    const result = await pool.query(
      `UPDATE auctions SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error editing auction:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Cancel an auction (only by creator, only if active)
app.post('/api/auctions/:id/cancel', authenticate_token, async (req, res) => {
  const auctionId = parseInt(req.params.id, 10);

  if (Number.isNaN(auctionId)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }

  try {
    const auctionResult = await pool.query(
      'SELECT id, creator_id, status FROM auctions WHERE id = $1',
      [auctionId]
    );

    if (auctionResult.rows.length === 0) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    const auction = auctionResult.rows[0];
    if (auction.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the auction creator can cancel this auction' });
    }
    if (auction.status !== 'active') {
      return res.status(400).json({ error: 'Only active auctions can be cancelled' });
    }

    await pool.query(
      "UPDATE auctions SET status = 'cancelled' WHERE id = $1",
      [auctionId]
    );

    res.status(200).json({ message: 'Auction cancelled successfully' });
  } catch (err) {
    console.error('Error cancelling auction:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get bid history for an auction
app.get('/api/auctions/:id/bids', async (req, res) => {
  const auctionId = parseInt(req.params.id, 10);

  if (Number.isNaN(auctionId)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }

  try {
    const auctionCheck = await pool.query(
      'SELECT id FROM auctions WHERE id = $1',
      [auctionId]
    );

    if (auctionCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Auction not found' });
    }

    const result = await pool.query(
      `
        SELECT b.id, b.amount, b.created_at, b.user_id, u.username
        FROM bids b
        JOIN users u ON u.id = b.user_id
        WHERE b.auction_id = $1
        ORDER BY b.amount DESC, b.created_at ASC
      `,
      [auctionId]
    );

    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching bid history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Place a bid on an auction
app.post('/api/auctions/:id/bids', authenticate_token, async (req, res) => {
  const auctionId = parseInt(req.params.id, 10);
  const { amount } = req.body;
  const userId = req.user.id;

  if (Number.isNaN(auctionId)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }

  if (amount === undefined || isNaN(amount) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Bid amount must be a positive number' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the auction row to avoid race conditions
    const auctionResult = await client.query(
      'SELECT id, starting_price, end_time, status FROM auctions WHERE id = $1 FOR UPDATE',
      [auctionId]
    );

    if (auctionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Auction not found' });
    }

    const auction = auctionResult.rows[0];

    // Enforce auction state & time rules
    if (auction.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Auction is not active' });
    }

    if (new Date(auction.end_time) <= new Date()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Auction has already ended' });
    }

    // Determine the current highest bid (or fallback to starting price)
    const highestBidResult = await client.query(
      'SELECT MAX(amount) AS max_amount FROM bids WHERE auction_id = $1',
      [auctionId]
    );

    const currentHighest = highestBidResult.rows[0].max_amount
      ? parseFloat(highestBidResult.rows[0].max_amount)
      : parseFloat(auction.starting_price);

    if (Number(amount) <= currentHighest) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Bid must be higher than the current highest bid' });
    }

    const insertResult = await client.query(
      'INSERT INTO bids (auction_id, user_id, amount) VALUES ($1, $2, $3) RETURNING *',
      [auctionId, userId, amount]
    );

    await client.query('COMMIT');

    console.log(`User ${userId} placed a bid of ${amount} on auction ${auctionId}`);

    // Send bid notification email to the auction creator (fire-and-forget)
    (async () => {
      try {
        const creatorResult = await pool.query(
          `SELECT u.email, u.username FROM users u
           JOIN auctions a ON a.creator_id = u.id
           WHERE a.id = $1`,
          [auctionId]
        );
        const creator = creatorResult.rows[0];
        if (creator && creator.email) {
          const bidderResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
          const bidderName = bidderResult.rows[0]?.username || 'Someone';
          await resend.emails.send({
            from: EMAIL_FROM,
            to: creator.email,
            subject: `New bid on your auction #${auctionId}`,
            text: `Hi ${creator.username},\n\n${bidderName} placed a bid of $${amount} on your auction #${auctionId}.\n\nLog in to view the latest activity.\n`,
          });
          console.log(`Bid notification sent to seller ${creator.email} for auction ${auctionId}`);
        }
      } catch (emailErr) {
        console.error('Failed to send bid notification to seller:', emailErr);
      }
    })();

    res.status(201).json({
      message: 'Bid placed successfully',
      bid: insertResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error placing bid:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Get current user profile
app.get('/api/me', authenticate_token, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update current user profile (email)
app.put('/api/me', authenticate_token, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check if email already used by another user
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, req.user.id]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email is already in use by another account' });
    }

    const result = await pool.query(
      'UPDATE users SET email = $1 WHERE id = $2 RETURNING id, username, email',
      [email, req.user.id]
    );
    res.status(200).json({ message: 'Profile updated', user: result.rows[0] });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all bids placed by the logged-in user
app.get('/api/me/bids', authenticate_token, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT b.id, b.amount, b.created_at, b.auction_id,
              a.title AS auction_title, a.status AS auction_status, a.winner_id
       FROM bids b
       JOIN auctions a ON a.id = b.auction_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching user bids:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});