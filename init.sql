CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);

-- Define the custom enum for auction status (enforces valid status values)
CREATE TYPE auction_status AS ENUM ('active', 'completed', 'cancelled', 'expired');

CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    starting_price DECIMAL NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status auction_status NOT NULL DEFAULT 'active',
    creator_id INTEGER NOT NULL REFERENCES users(id),
    winner_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS bids (
    id SERIAL PRIMARY KEY,
    auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount DECIMAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Insert a mock user for testing
INSERT INTO users (username, password_hash) VALUES ('testuser', 'hashedpassword123') ON CONFLICT DO NOTHING;