-- Create a test user for testing Meta OAuth
-- Password is 'test123' hashed with bcrypt
INSERT INTO users (id, email, password_hash, name)
VALUES (
    '86366871-1f70-457d-8976-74cf6e22282a',
    'lukem@plankton.com.au',
    '$2a$10$Xr2QZxT5KsRlKqB5DJYOHOWLGTtEHAEQxMTHXZqT7LYgZUfGZGPyG',
    'Luke Moulton'
)
ON CONFLICT (email) DO NOTHING;