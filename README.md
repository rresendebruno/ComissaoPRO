# ⛽ ComissõesPRO — Sistema de Comissionamento

Sistema completo de gestão de comissões para postos de combustível com importação via Google Sheets.

---

## 🚀 Deploy com Docker (produção)

### Pré-requisitos
- Docker + Docker Compose instalados no servidor

### 1. Configurar variáveis de ambiente
```bash
cp .env.example .env
# Edite .env com suas senhas
nano .env
```

### 2. Subir o sistema
```bash
docker-compose up -d --build
```

O sistema estará disponível na porta 80 (ou a porta definida em `APP_PORT`).

### 3. Acesso inicial
- **URL:** `http://SEU_IP` ou `http://seu-dominio.com`
- **Login:** `admin` / `admin123`
- ⚠️ **Altere a senha do admin imediatamente após o primeiro login!**

---

## 📋 Fluxo de Uso

### 1. Cadastrar Postos
- Vá em **Postos** → Novo Posto
- Defina código (P1, P2...) e nome

### 2. Configurar Gerentes e Trocadores
- Clique no posto → aba **Gerentes & Trocadores**
- Adicione os nomes **exatamente como aparecem na planilha** (coluna B)
- Qualquer funcionário não cadastrado será considerado frentista

### 3. Cadastrar Produtos Especiais
- No posto → aba **Produtos Especiais**
- Informe nome exato do produto (como na coluna C da planilha)
- Defina valor de comissão por unidade para cada tipo

### 4. Criar Período de Apuração
- Vá em **Períodos** → Novo Período
- Ciclo padrão: dia 26 ao dia 25 do mês seguinte
- Cole a URL do Google Sheets (opcional agora, pode adicionar depois)

### 5. Definir Metas
- Dentro do período → aba **Metas**
- Defina meta de frentistas e trocadores separadamente para cada posto

### 6. Importar Vendas
- Dentro do período → aba **Importar Vendas**
- Cole a URL da planilha Google Sheets
- Clique em Importar

### 7. Ver Comissões
- Vá em **Comissões**
- Selecione o período
- Clique em qualquer posto para expandir os detalhes

---

## 📊 Regras de Comissionamento

### Frentistas
| Atingimento da Meta | Comissão |
|---------------------|----------|
| < 50% | 0% |
| 50% – 75% | 3% do valor vendido |
| 75% – 100% | 4,5% do valor vendido |
| 100% – 150% | 6% do valor vendido |
| ≥ 150% | 10% do valor vendido |

### Trocadores de Óleo
| Atingimento da Meta | Comissão |
|---------------------|----------|
| < 50% | 0% |
| 50% – 75% | 5% do valor vendido |
| 75% – 100% | 7% do valor vendido |
| 100% – 150% | 10% do valor vendido |
| ≥ 150% | 15% do valor vendido |

### Gerente
| Condição | Comissão |
|----------|----------|
| Meta não atingida | 0% |
| Meta atingida (≥ 100%) | 3% do **total do posto** (frentistas + trocadores + gerente) |

**Todos** também recebem o valor fixo por unidade dos **Produtos Especiais** vendidos.

---

## 📁 Formato da Planilha Google Sheets

| Coluna | Campo | Exemplo |
|--------|-------|---------|
| A | Posto (código) | P1, P4, P21... |
| B | Funcionário | 000006 - CARLOS ROBERTO ALVES |
| C | Produto | CASTROL MAGNATEC 5W40 LT |
| D | Quantidade | 2 |
| E | Valor Unitário | 85.00 |
| F | Valor Bruto | 170.00 |
| G | Valor Desconto | 0 |
| H | Valor Acréscimo | 0 |
| I | Valor Final | 170.00 |

**A planilha deve ser compartilhada como pública (qualquer pessoa com o link pode ler).**

---

## 🏗️ Arquitetura

```
comissoes-system/
├── docker-compose.yml        # Orquestração dos 3 containers
├── .env.example              # Template de variáveis de ambiente
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js         # Express app + migrações
│       ├── comissoes.js      # ⭐ Motor de cálculo de comissões
│       ├── db/index.js       # PostgreSQL + schema SQL
│       ├── middleware/auth.js
│       └── routes/
│           ├── auth.js       # Login + CRUD usuários
│           ├── postos.js     # Postos + funcionários + produtos especiais
│           └── periodos.js   # Períodos + metas + importação + comissões
└── frontend/
    ├── Dockerfile            # Build React + Nginx
    ├── nginx.conf            # Proxy /api → backend
    └── src/
        ├── pages/
        │   ├── LoginPage.js
        │   ├── DashboardPage.js    # Charts + ranking
        │   ├── PeriodosPage.js     # Lista de períodos
        │   ├── PeriodoDetailPage.js # Metas + importação + vendas
        │   ├── ComissoesPage.js    # ⭐ Relatório principal
        │   ├── PostosPage.js
        │   ├── PostoDetailPage.js  # Gerentes + trocadores + produtos esp.
        │   └── UsuariosPage.js
        └── utils/fmt.js       # Formatadores + lógica de faixas
```

---

## 🔧 Comandos Úteis

```bash
# Ver logs
docker-compose logs -f

# Reiniciar backend
docker-compose restart backend

# Backup do banco
docker exec comissoes-db pg_dump -U comissoes comissoes > backup.sql

# Restaurar banco
cat backup.sql | docker exec -i comissoes-db psql -U comissoes comissoes

# Parar tudo
docker-compose down

# Parar e apagar dados (⚠️ cuidado!)
docker-compose down -v
```

---

## 🔒 Segurança em Produção

1. Altere `JWT_SECRET` e `POSTGRES_PASSWORD` no `.env`
2. Use HTTPS com Nginx Proxy Manager ou Certbot
3. Configure firewall para expor apenas porta 80/443
4. Faça backups regulares do volume `postgres_data`
