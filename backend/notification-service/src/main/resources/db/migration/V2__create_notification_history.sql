CREATE TABLE notification_history (
    id UUID PRIMARY KEY,
    event_id UUID NOT NULL,
    event_type VARCHAR(120) NOT NULL,
    tracking_id VARCHAR(120) NOT NULL,
    payload JSON NOT NULL,
    status VARCHAR(30) NOT NULL,
    error_detail VARCHAR(1000),
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uk_notification_history_event_id UNIQUE (event_id)
);