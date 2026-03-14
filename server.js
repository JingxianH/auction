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
    let query = 'SELECT * FROM auctions WHERE 1=1';
    let values = [];
    let counter = 1;

    if (search) {
      query += ` AND title ILIKE $${counter}`;
      values.push(`%${search}%`);
      counter++;
    }

    if (status === 'active') {
      query += " AND status = 'active' AND end_time > CURRENT_TIMESTAMP";
    } else if (status === 'completed') {
      query += " AND (status = 'completed' OR end_time <= CURRENT_TIMESTAMP)";
    }

    query += ' ORDER BY end_time ASC';

    const result = await pool.query(query, values);
    res.status(200).json(result.rows);
  } catch (err) {
    console.error('Error fetching auctions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});