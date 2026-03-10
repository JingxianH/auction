const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'auctiondb',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

app.get('/health', (req, res) => {
  res.status(200).send('Auction API is healthy - CI/CD Automation Successful!');
});


app.post('/api/auctions', async (req, res) => {
  const { title, description, starting_price, end_time, creator_id } = req.body;

  if (!title || !starting_price || !end_time || !creator_id) {
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