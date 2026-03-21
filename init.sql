CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL
);

-- Migration: add email column if table was created from older schema
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT '';

-- Define the custom enum for auction status (enforces valid status values)
DO $$ BEGIN
  CREATE TYPE auction_status AS ENUM ('active', 'completed', 'cancelled', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    starting_price DECIMAL(10, 2) NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    status auction_status NOT NULL DEFAULT 'active',
    creator_id INTEGER NOT NULL REFERENCES users(id),
    winner_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Transactional Outbox for reliable email delivery
CREATE TABLE IF NOT EXISTS outbox_notifications (
    id SERIAL PRIMARY KEY,
    recipient_email VARCHAR(255) NOT NULL,
    username VARCHAR(50),
    auction_id INTEGER NOT NULL,
    amount DECIMAL(10, 2),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Insert a mock user for testing
INSERT INTO users (username, password_hash, email) 
VALUES ('testuser', 'hashedpassword123', 'testuser@example.com') 
ON CONFLICT DO NOTHING;