ALTER TABLE tokens_auth DROP CONSTRAINT chk_tokens_auth_tipo;
ALTER TABLE tokens_auth ADD CONSTRAINT chk_tokens_auth_tipo
    CHECK (tipo IN ('REFRESH', 'VERIFICACION_CORREO', 'RECUPERACION_PASSWORD'));
