const { Pool } = require('pg');
const { Resend } = require('resend');

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'db',
  database: process.env.DB_NAME || 'auctiondb',
  password: process.env.DB_PASSWORD || 'postgres',
  port: process.env.DB_PORT || 5432,
});

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = process.env.EMAIL_FROM || 'onboarding@resend.dev';

async function sendWinnerEmail({ email, username, auctionId, amount }) {
  if (!email) {
    throw new Error('No recipient email provided');
  }

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `Congratulations! You won auction ${auctionId}`,
    text: `Hi ${username || 'bidder'},\n\nYou have won auction #${auctionId} with a bid of $${amount}.\nPlease log in to your account to view payment and shipping details.\n\nThanks for participating!\n`,
  });
}

async function sendSellerEmail({ email, username, auctionId, amount, winnerUsername }) {
  if (!email) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `Your auction #${auctionId} has been completed!`,
    text: `Hi ${username || 'seller'},\n\nYour auction #${auctionId} has been completed.\nWinner: ${winnerUsername}\nWinning bid: $${amount}\n\nPlease log in to your account to view the winner details and arrange next steps.\n\nThanks for using Auction Platform!\n`,
  });
}

async function sendLoserEmail({ email, username, auctionId, auctionTitle, winningAmount }) {
  if (!email) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `Auction "${auctionTitle}" (#${auctionId}) has ended`,
    text: `Hi ${username || 'bidder'},\n\nThe auction "${auctionTitle}" (#${auctionId}) you bid on has ended.\nUnfortunately, your bid was not the winning bid.\nThe winning bid was $${winningAmount}.\n\nCheck out other active auctions on the platform!\n\nThanks for participating!\n`,
  });
}

async function sendExpiredNoBidsEmail({ email, username, auctionId, auctionTitle, role }) {
  if (!email) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: `Auction "${auctionTitle}" (#${auctionId}) expired with no bids`,
    text: `Hi ${username || 'user'},\n\nThe auction "${auctionTitle}" (#${auctionId}) has expired without receiving any bids.\n${role === 'seller' ? 'You may create a new auction if you wish to relist the item.\n\n' : 'Check out other active auctions on the platform!\n\n'}Thanks for using Auction Platform!\n`,
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