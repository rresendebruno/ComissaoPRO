require('express-async-errors');
const express = require('express');
const cors = require('cors');
const { migrate } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/postos', require('./routes/postos'));
app.use('/api/periodos', require('./routes/periodos'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === '23505') return res.status(409).json({ error: 'Registro duplicado' });
  res.status(500).json({ error: err.message || 'Erro interno do servidor' });
});

const PORT = process.env.PORT || 3001;

migrate().then(() => {
  app.listen(PORT, () => console.log(`Backend rodando na porta ${PORT}`));
}).catch(err => {
  console.error('Falha ao migrar banco:', err);
  process.exit(1);
});
