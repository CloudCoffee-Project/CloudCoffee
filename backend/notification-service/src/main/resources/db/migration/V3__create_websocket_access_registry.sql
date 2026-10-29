CREATE TABLE notification_order_access (
    order_id UUID PRIMARY KEY,
    purchase_id UUID NOT NULL,
    client_id UUID NOT NULL,
    cafeteria_id UUID NOT NULL
);

CREATE INDEX idx_notification_order_access_purchase_id
    ON notification_order_access (purchase_id);

CREATE INDEX idx_notification_order_access_client_id
    ON notification_order_access (client_id);

CREATE INDEX idx_notification_order_access_cafeteria_id
    ON notification_order_access (cafeteria_id);

CREATE TABLE notification_purchase_access (
    purchase_id UUID PRIMARY KEY,
    client_id UUID NOT NULL
);
