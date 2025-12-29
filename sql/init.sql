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
    steps TEXT NOT NULL DEFAULT '[]',
    list_id TEXT,
    canvas_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_workflows_app_id ON workflows (app_id);

CREATE TABLE workflow_versions (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    workflow_id INTEGER NOT NULL,
    steps TEXT NOT NULL,
    created_at REAL NOT NULL,
    FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE
);
CREATE INDEX idx_workflow_versions_workflow_id ON workflow_versions (workflow_id);
CREATE INDEX idx_workflow_versions_created_at ON workflow_versions (created_at);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    version_id INTEGER NOT NULL,
    trigger_user_id TEXT NOT NULL,
    trigger_id TEXT,
    step_index INTEGER NOT NULL DEFAULT 0, -- index of next step
    state TEXT NOT NULL,
    FOREIGN KEY (version_id) REFERENCES workflow_versions (id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_version_id ON workflow_executions (version_id);

CREATE TABLE IF NOT EXISTS config_tokens (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at REAL NOT NULL,
    user_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY NOT NULL,
    api_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users (api_key);

CREATE TABLE IF NOT EXISTS triggers (
    id INTEGER PRIMARY KEY NOT NULL GENERATED ALWAYS AS IDENTITY,
    execution_id INTEGER,
    workflow_id INTEGER,
    type TEXT NOT NULL,
    val_string TEXT,
    val_number BIGINT,
    func TEXT NOT NULL,  -- the function to call (not with eval lol)
    details TEXT,  -- optional data passed to func
    FOREIGN KEY (execution_id) REFERENCES workflow_executions (id) ON DELETE CASCADE,
    FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_triggers_execution_id ON triggers (execution_id);
CREATE INDEX IF NOT EXISTS idx_triggers_workflow_id ON triggers (workflow_id);
CREATE INDEX IF NOT EXISTS idx_triggers_type ON triggers (type);
CREATE INDEX IF NOT EXISTS idx_triggers_type_val_string ON triggers (type, val_string);
CREATE INDEX IF NOT EXISTS idx_triggers_type_val_number ON triggers (type, val_number);

-- all timestamps are in ms
