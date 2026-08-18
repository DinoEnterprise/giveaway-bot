CREATE TABLE IF NOT EXISTS giveaways (
    id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    prize TEXT NOT NULL,
    winners INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS claims (
    id TEXT PRIMARY KEY,
    giveaway_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'processing',
    created_at TEXT NOT NULL,
    UNIQUE(giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    giveaway_id TEXT NOT NULL,
    claim_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    channel_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
);
