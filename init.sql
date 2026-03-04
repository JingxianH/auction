CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);

-- Define the custom enum for auction status
CREATE TYPE auction_status AS ENUM ('active', 'completed', 'cancelled');

CREATE TABLE auctions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    starting_price DECIMAL NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    creator_id INTEGER NOT NULL,
    winner_id INTEGER
);

CREATE TABLE bids (
    id SERIAL PRIMARY KEY,
    auction_id INTEGER REFERENCES auctions(id),
    user_id INTEGER NOT NULL,
    amount DECIMAL NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- Insert a mock user for testing
INSERT INTO users (username, password_hash) VALUES ('testuser', 'hashedpassword123') ON CONFLICT DO NOTHING;