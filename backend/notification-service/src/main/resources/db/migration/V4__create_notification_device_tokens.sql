CREATE TABLE notification_device_token (
    id UUID PRIMARY KEY,
    token TEXT NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    user_id UUID NOT NULL,
    platform VARCHAR(10) NOT NULL,
    token_type VARCHAR(10) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_notification_device_token_hash UNIQUE (token_hash),
    CONSTRAINT ck_notification_device_token_platform CHECK (platform IN ('ANDROID', 'IOS')),
    CONSTRAINT ck_notification_device_token_type CHECK (token_type IN ('FCM', 'APNS')),
    CONSTRAINT ck_notification_device_token_platform_type CHECK (
        (platform = 'ANDROID' AND token_type = 'FCM')
        OR platform = 'IOS'
    )
);

CREATE INDEX ix_notification_device_token_user
    ON notification_device_token (user_id);
