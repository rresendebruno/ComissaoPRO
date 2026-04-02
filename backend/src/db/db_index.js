const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.on('error', (err) => console.error('DB pool error:', err));

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function migrate() {
  // Tabelas principais
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      role VARCHAR(20) NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin','viewer')),
      ativo BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS postos (
      id SERIAL PRIMARY KEY,
      codigo VARCHAR(20) UNIQUE NOT NULL,
      nome VARCHAR(255) NOT NULL,
      ativo BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS periodos (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      data_inicio DATE NOT NULL,
      data_fim DATE NOT NULL,
      sheets_url TEXT,
      status VARCHAR(20) DEFAULT 'ativo' CHECK (status IN ('ativo','fechado')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS periodo_funcionarios (
      id         SERIAL PRIMARY KEY,
      periodo_id INTEGER REFERENCES periodos(id) ON DELETE CASCADE,
      posto_id   INTEGER REFERENCES postos(id)   ON DELETE CASCADE,
      nome       VARCHAR(255) NOT NULL,
      tipo       VARCHAR(20)  NOT NULL CHECK (tipo IN ('gerente','trocador'))
    );

    CREATE TABLE IF NOT EXISTS metas (
      id             SERIAL PRIMARY KEY,
      posto_id       INTEGER REFERENCES postos(id)   ON DELETE CASCADE,
      periodo_id     INTEGER REFERENCES periodos(id)  ON DELETE CASCADE,
      meta_frentista NUMERIC(15,2) NOT NULL DEFAULT 0,
      meta_trocador  NUMERIC(15,2) NOT NULL DEFAULT 0,
      meta_posto     NUMERIC(15,2) NOT NULL DEFAULT 0,
      UNIQUE(posto_id, periodo_id)
    );

    CREATE TABLE IF NOT EXISTS produtos_especiais (
      id                 SERIAL PRIMARY KEY,
      posto_id           INTEGER REFERENCES postos(id) ON DELETE CASCADE,
      nome_produto       VARCHAR(500) NOT NULL,
      comissao_frentista NUMERIC(10,2) NOT NULL DEFAULT 0,
      comissao_trocador  NUMERIC(10,2) NOT NULL DEFAULT 0,
      comissao_gerente   NUMERIC(10,2) NOT NULL DEFAULT 0,
      ativo              BOOLEAN DEFAULT true,
      UNIQUE(posto_id, nome_produto)
    );

    CREATE TABLE IF NOT EXISTS vendas (
      id               SERIAL PRIMARY KEY,
      periodo_id       INTEGER REFERENCES periodos(id) ON DELETE CASCADE,
      posto_id         INTEGER REFERENCES postos(id)   ON DELETE CASCADE,
      funcionario      VARCHAR(255) NOT NULL,
      tipo_funcionario VARCHAR(20)  NOT NULL CHECK (tipo_funcionario IN ('frentista','trocador','gerente')),
      produto          VARCHAR(500) NOT NULL,
      quantidade       NUMERIC(10,3) NOT NULL DEFAULT 0,
      valor_unitario   NUMERIC(15,2) NOT NULL DEFAULT 0,
      valor_bruto      NUMERIC(15,2) NOT NULL DEFAULT 0,
      valor_desconto   NUMERIC(15,2) NOT NULL DEFAULT 0,
      valor_acrescimo  NUMERIC(15,2) NOT NULL DEFAULT 0,
      valor_final      NUMERIC(15,2) NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_vendas_periodo     ON vendas(periodo_id);
    CREATE INDEX IF NOT EXISTS idx_vendas_posto       ON vendas(posto_id);
    CREATE INDEX IF NOT EXISTS idx_vendas_funcionario ON vendas(funcionario);

    ALTER TABLE metas ADD COLUMN IF NOT EXISTS meta_posto NUMERIC(15,2) NOT NULL DEFAULT 0;
  `);

  // FIX 2: Tabela de desqualificados persistida no banco
  await query(`
    CREATE TABLE IF NOT EXISTS periodo_desqualificados (
      id          SERIAL PRIMARY KEY,
      periodo_id  INTEGER REFERENCES periodos(id) ON DELETE CASCADE,
      posto_id    INTEGER NOT NULL,
      posto_codigo VARCHAR(20) NOT NULL,
      nome        VARCHAR(255) NOT NULL,
      tipo        VARCHAR(20)  NOT NULL CHECK (tipo IN ('frentista','trocador','gerente')),
      motivo      TEXT DEFAULT '',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(periodo_id, posto_id, nome, tipo)
    );
    CREATE INDEX IF NOT EXISTS idx_desq_periodo ON periodo_desqualificados(periodo_id);
  `);

  // Migração da constraint de periodo_funcionarios
  await query(`
    DO $migration$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'periodo_funcionarios_periodo_id_posto_id_nome_key'
      ) THEN
        ALTER TABLE periodo_funcionarios
          DROP CONSTRAINT periodo_funcionarios_periodo_id_posto_id_nome_key;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'periodo_funcionarios_periodo_posto_nome_tipo_key'
      ) THEN
        ALTER TABLE periodo_funcionarios
          ADD CONSTRAINT periodo_funcionarios_periodo_posto_nome_tipo_key
          UNIQUE (periodo_id, posto_id, nome, tipo);
      END IF;
    END
    $migration$;
  `);

  const { rows } = await query(`SELECT id FROM users WHERE username = 'admin'`);
  if (rows.length === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    await query(
      `INSERT INTO users (username, password_hash, name, role) VALUES ('admin', $1, 'Administrador', 'admin')`,
      [hash]
    );
    console.log('Admin user created: admin / admin123');
  }
  console.log('Database migrated successfully');
}

module.exports = { query, migrate };
