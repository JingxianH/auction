CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL
);

-- Define the custom enum for auction status
CREATE TYPE auction_status AS ENUM ('active', 'completed', 'cancelled');

CREATE TABLE IF NOT EXISTS auctions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    starting_price DECIMAL(10, 2) NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status auction_status DEFAULT 'active',
    creator_id INTEGER REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert a mock user for testing
INSERT INTO users (username, password_hash) VALUES ('testuser', 'hashedpassword123') ON CONFLICT DO NOTHING;