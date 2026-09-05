-- Schema de referencia para o driver MySqlBatchJobRepository.
-- Nao roda automaticamente (nao ha migration runner no projeto - fora do
-- escopo do teste). Se DB_DRIVER=mysql, aplique manualmente contra o
-- banco configurado em .env antes de subir a aplicacao.

CREATE TABLE IF NOT EXISTS cep_batch_jobs (
  id CHAR(36) NOT NULL PRIMARY KEY,
  idempotency_key VARCHAR(255) NOT NULL,
  webhook_url VARCHAR(2048) NOT NULL,
  ceps JSON NOT NULL,
  status ENUM('pending', 'processing', 'completed', 'delivered', 'dead_letter') NOT NULL DEFAULT 'pending',
  results JSON NOT NULL,
  delivery_attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uq_cep_batch_jobs_idempotency_key (idempotency_key),
  KEY idx_cep_batch_jobs_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
