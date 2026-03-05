const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'auctiondb',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

async function processExpiredAuctions() {
  const client = await pool.connect();
  try {
    console.log('Worker running: Checking for expired auctions...');
    await client.query('BEGIN');

    // 1. Find auctions that are active but past due
    const expiredQuery = `
      SELECT id FROM auctions 
      WHERE status = 'active' AND end_time <= CURRENT_TIMESTAMP 
      FOR UPDATE SKIP LOCKED`;
    const { rows: expiredAuctions } = await client.query(expiredQuery);

    for (const auction of expiredAuctions) {
      // 2. Find highest bidder
      const bidQuery = `
        SELECT user_id, amount FROM bids 
        WHERE auction_id = $1 
        ORDER BY amount DESC LIMIT 1`;
      const { rows: bids } = await client.query(bidQuery, [auction.id]);

      if (bids.length > 0) {
        const winnerId = bids[0].user_id;
        // 3. Mark as completed and assign winner
        await client.query(
          `UPDATE auctions 
           SET status = 'completed', winner_id = $1 
           WHERE id = $2`, 
          [winnerId, auction.id]
        );
        console.log(`Auction ${auction.id} won by ${winnerId}`);
      } else {
        // No bids case
        await client.query(
          "UPDATE auctions SET status = 'expired' WHERE id = $1", 
          [auction.id]
        );
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Worker Error:', e);
  } finally {
    client.release();
  }
}

// Run every 10 seconds
setInterval(processExpiredAuctions, 10000);