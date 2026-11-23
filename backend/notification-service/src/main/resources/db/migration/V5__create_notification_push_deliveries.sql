CREATE TABLE notification_push_delivery (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    channel VARCHAR(20) NOT NULL,
    device_token_id UUID NOT NULL,
    title VARCHAR(120) NOT NULL,
    body VARCHAR(240) NOT NULL,
    data JSON NOT NULL,
    status VARCHAR(20) NOT NULL,
    attempt_count INTEGER NOT NULL,
    next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_error VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_notification_push_delivery_event_channel_device
        UNIQUE (event_id, channel, device_token_id),
    CONSTRAINT ck_notification_push_delivery_channel CHECK (channel = 'FCM'),
    CONSTRAINT ck_notification_push_delivery_status CHECK (status IN ('PENDING', 'SENT', 'FAILED'))
);

CREATE INDEX ix_notification_push_delivery_pending
    ON notification_push_delivery (status, next_attempt_at, created_at);
