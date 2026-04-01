CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT '';

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

ALTER TABLE auctions
ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS followers (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_auctions_creator_id ON auctions(creator_id);
CREATE INDEX IF NOT EXISTS idx_auctions_is_private ON auctions(is_private);
CREATE INDEX IF NOT EXISTS idx_followers_following_id ON followers(following_id);

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

-- Persistent Prometheus metrics snapshots (survive deployments)
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id INTEGER PRIMARY KEY DEFAULT 1,
    metrics_json JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CHECK (id = 1)
);

-- Insert a mock user for testing
INSERT INTO users (username, password_hash, email) 
VALUES ('testuser', 'hashedpassword123', 'testuser@example.com') 
ON CONFLICT DO NOTHING;