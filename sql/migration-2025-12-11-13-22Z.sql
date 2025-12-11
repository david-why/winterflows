ALTER TABLE users DROP COLUMN access_token;
ALTER TABLE users DROP COLUMN scopes;
ALTER TABLE users ADD COLUMN api_key TEXT;
CREATE INDEX idx_users_api_key ON users (api_key);
