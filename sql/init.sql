CREATE TABLE IF NOT EXISTS workflows (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT 'A brand new workflow',
    creator_user_id TEXT NOT NULL,
    app_id TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL UNIQUE,
    client_secret TEXT NOT NULL,
    signing_secret TEXT NOT NULL,
    access_token TEXT,
    steps TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_workflows_app_id ON workflows (app_id);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    workflow_id INTEGER NOT NULL,
    steps TEXT NOT NULL,
    step_index INTEGER NOT NULL DEFAULT 0, -- index of next step
    state TEXT NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows (id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions (workflow_id);

CREATE TABLE IF NOT EXISTS config_tokens (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at REAL NOT NULL,
    user_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    access_token TEXT,
    scopes TEXT  -- space separated
);

-- all timestamps are in ms
