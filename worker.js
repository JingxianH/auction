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

async function sendSellerEmail({ email, username, auctionId, amount, winnerUsername }) {
  if (!email) return;

  const from = process.env.EMAIL_FROM || 'no-reply@auction.example.com';
  const subject = `Your auction #${auctionId} has been completed!`;
  const text = `Hi ${username || 'seller'},\n\n` +
    `Your auction #${auctionId} has been completed.\n` +
    `Winner: ${winnerUsername}\n` +
    `Winning bid: $${amount}\n\n` +
    'Please log in to your account to view the winner details and arrange next steps.\n\n' +
    'Thanks for using Auction Platform!\n';

  await transporter.sendMail({ from, to: email, subject, text });
}

async function sendLoserEmail({ email, username, auctionId, auctionTitle, winningAmount }) {
  if (!email) return;

  const from = process.env.EMAIL_FROM || 'no-reply@auction.example.com';
  const subject = `Auction "${auctionTitle}" (#${auctionId}) has ended`;
  const text = `Hi ${username || 'bidder'},\n\n` +
    `The auction "${auctionTitle}" (#${auctionId}) you bid on has ended.\n` +
    `Unfortunately, your bid was not the winning bid.\n` +
    `The winning bid was $${winningAmount}.\n\n` +
    'Check out other active auctions on the platform!\n\n' +
    'Thanks for participating!\n';

  await transporter.sendMail({ from, to: email, subject, text });
}

async function sendExpiredNoBidsEmail({ email, username, auctionId, auctionTitle, role }) {
  if (!email) return;

  const from = process.env.EMAIL_FROM || 'no-reply@auction.example.com';
  const subject = `Auction "${auctionTitle}" (#${auctionId}) expired with no bids`;
  const text = `Hi ${username || 'user'},\n\n` +
    `The auction "${auctionTitle}" (#${auctionId}) has expired without receiving any bids.\n` +
    (role === 'seller'
      ? 'You may create a new auction if you wish to relist the item.\n\n'
      : 'Check out other active auctions on the platform!\n\n') +
    'Thanks for using Auction Platform!\n';

  await transporter.sendMail({ from, to: email, subject, text });
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
      // Fetch auction title for email context
      const auctionMeta = await client.query('SELECT title, creator_id FROM auctions WHERE id = $1', [auction.id]);
      const auctionTitle = auctionMeta.rows[0]?.title || `Auction #${auction.id}`;
      const creatorId = auctionMeta.rows[0]?.creator_id;

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
            type: 'winner',
            email: winner.email,
            username: winner.username,
            auctionId: auction.id,
            amount: winningAmount,
          });

          // Write to outbox for audit trail and reliable retry
          await client.query(
            `INSERT INTO outbox_notifications (recipient_email, username, auction_id, amount, status)
             VALUES ($1, $2, $3, $4, 'pending')`,
            [winner.email, winner.username, auction.id, winningAmount]
          );
        } else {
          console.warn(`Winner user ${winnerId} has no email; notification not sent`);
        }

        // Notify the seller that their auction completed
        const sellerResult = await client.query(
          'SELECT u.username, u.email FROM users u WHERE u.id = $1',
          [creatorId]
        );
        const seller = sellerResult.rows[0];
        if (seller && seller.email) {
          notifications.push({
            type: 'seller',
            email: seller.email,
            username: seller.username,
            auctionId: auction.id,
            amount: winningAmount,
            winnerUsername: winner ? winner.username : 'Unknown',
          });
        }

        // Notify ALL losing bidders (distinct users who are not the winner)
        const loserResult = await client.query(
          `SELECT DISTINCT u.id, u.username, u.email
           FROM bids b JOIN users u ON u.id = b.user_id
           WHERE b.auction_id = $1 AND b.user_id != $2`,
          [auction.id, winnerId]
        );
        for (const loser of loserResult.rows) {
          if (loser.email) {
            notifications.push({
              type: 'loser',
              email: loser.email,
              username: loser.username,
              auctionId: auction.id,
              auctionTitle,
              winningAmount,
            });
          }
        }

        console.log(`Auction ${auction.id} won by ${winnerId}`);
      } else {
        // No bids — expire the auction and notify the seller
        await client.query(
          "UPDATE auctions SET status = 'expired' WHERE id = $1",
          [auction.id]
        );

        const sellerResult = await client.query(
          'SELECT username, email FROM users WHERE id = $1',
          [creatorId]
        );
        const seller = sellerResult.rows[0];
        if (seller && seller.email) {
          notifications.push({
            type: 'expired',
            email: seller.email,
            username: seller.username,
            auctionId: auction.id,
            auctionTitle,
            role: 'seller',
          });
        }

        console.log(`Auction ${auction.id} expired with no bids`);
      }
    }

    await client.query('COMMIT');

    // 4. Send notifications after commit (don't affect auction status transaction)
    for (const notification of notifications) {
      try {
        switch (notification.type) {
          case 'winner':
            await sendWinnerEmail(notification);
            console.log(`Winner notification sent to ${notification.email} for auction ${notification.auctionId}`);
            await pool.query(
              `UPDATE outbox_notifications SET status = 'sent' WHERE auction_id = $1 AND recipient_email = $2`,
              [notification.auctionId, notification.email]
            );
            break;
          case 'seller':
            await sendSellerEmail(notification);
            console.log(`Seller notification sent to ${notification.email} for auction ${notification.auctionId}`);
            break;
          case 'loser':
            await sendLoserEmail(notification);
            console.log(`Loser notification sent to ${notification.email} for auction ${notification.auctionId}`);
            break;
          case 'expired':
            await sendExpiredNoBidsEmail(notification);
            console.log(`Expired notification sent to ${notification.email} for auction ${notification.auctionId}`);
            break;
        }
      } catch (sendErr) {
        console.error(`Failed to send ${notification.type} notification to ${notification.email}:`, sendErr);
        if (notification.type === 'winner') {
          await pool.query(
            `UPDATE outbox_notifications SET status = 'failed' WHERE auction_id = $1 AND recipient_email = $2`,
            [notification.auctionId, notification.email]
          );
        }
      }
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Worker Error:', e);
  } finally {
    client.release();
  }
}


const WORKER_INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS) || 3600000;
processExpiredAuctions();
setInterval(processExpiredAuctions, WORKER_INTERVAL_MS);