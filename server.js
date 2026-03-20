const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // to create and check login tokens

const app = express();
app.use(express.json());

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
  const { username, password } = req.body; // username and password

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const existing_user = await pool.query(
      'SELECT id FROM users WHERE username = $1',
      [username]
    );

    if (existing_user.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const insert_user_result = await pool.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username`,
      [username, password_hash]
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
        SELECT a.*, b.highest_bid
        FROM auctions a
        LEFT JOIN (
          SELECT auction_id, MAX(amount) AS highest_bid
          FROM bids
          GROUP BY auction_id
        ) b ON a.id = b.auction_id
        WHERE a.creator_id = $1
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
        SELECT a.*, b.highest_bid
        FROM auctions a
        LEFT JOIN (
          SELECT auction_id, MAX(amount) AS highest_bid
          FROM bids
          GROUP BY auction_id
        ) b ON a.id = b.auction_id
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});