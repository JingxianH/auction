const { Pool } = require('pg');
const nodemailer = require('nodemailer');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'auctiondb',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER
    ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      }
    : undefined,
});

async function sendWinnerEmail({ email, username, auctionId, amount }) {
  if (!email) {
    throw new Error('No recipient email provided');
  }

  const from = process.env.EMAIL_FROM || 'no-reply@auction.example.com';
  const subject = `Congratulations! You won auction ${auctionId}`;
  const text = `Hi ${username || 'bidder'},\n\n` +
    `You have won auction #${auctionId} with a bid of $${amount}.\n` +
    'Please log in to your account to view payment and shipping details.\n\n' +
    'Thanks for participating!\n';

  await transporter.sendMail({
    from,
    to: email,
    subject,
    text,
  });
}

async function processExpiredAuctions() {
  const client = await pool.connect();
  const notifications = [];
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
        const winningAmount = bids[0].amount;

        // 3. Mark as completed and assign winner
        await client.query(
          `UPDATE auctions 
           SET status = 'completed', winner_id = $1 
           WHERE id = $2`,
          [winnerId, auction.id]
        );

        const winnerResult = await client.query(
          'SELECT username, email FROM users WHERE id = $1',
          [winnerId]
        );
        const winner = winnerResult.rows[0];

        if (winner && winner.email) {
          notifications.push({
            email: winner.email,
            username: winner.username,
            auctionId: auction.id,
            amount: winningAmount,
          });
        } else {
          console.warn(`Winner user ${winnerId} has no email; notification not sent`);
        }

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

    // 4. Send notifications after commit (don't affect auction status transaction)
    for (const notification of notifications) {
      try {
        await sendWinnerEmail(notification);
        console.log(`Winner notification sent to ${notification.email} for auction ${notification.auctionId}`);
      } catch (sendErr) {
        console.error(`Failed to send notification to ${notification.email}:`, sendErr);
      }
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Worker Error:', e);
  } finally {
    client.release();
  }
}

// Run every 1 hour by default (configurable via WORKER_INTERVAL_MS)
const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS) || 3600000;
setInterval(processExpiredAuctions, WORKER_INTERVAL_MS);