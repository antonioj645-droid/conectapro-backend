require('dotenv').config();

const express = require('express');
const cors = require (!admin.apps.length) {const cors = require('cors');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  console.log("✅ Firebase conectado com sucesso");

} catch (err) {
  console.error("❌ Erro ao iniciar Firebase:", err.message);
  process.exit(1);
}

// =========================
// ✅ LOG DE TODAS AS ROTAS (DEBUG)
// =========================
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// =========================
// ✅ ROTAS
// =========================

// ✅ PIX
const pixRoutes = require('./routes/pix');
app.use('/pix', pixRoutes);

// ✅ CARTEIRA
const carteiraRoutes = require('./routes/carteira');
app.use('/carteira', carteiraRoutes);

// =========================
// ✅ ROTA TESTE
// =========================
app.get('/', (req, res) => {
  res.send('✅ Backend ConectaPro rodando');
});

// =========================
// ✅ PORTA
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});

const admin = require('firebase-admin');

const app = express();

// ✅ 🔥 IMPORTANTE PRO RENDER
app.set('trust proxy', 1);

// =========================
// ✅ CORS (VERSÃO FINAL CORRETA)
// =========================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ✅ REMOVIDO wildcard problemático 'app.options("*")'
// Express moderno já trata isso automaticamente

app.use(express.json());

// =========================
// ✅ FIREBASE
// =========================
try {

  if (!process.env.FIREBASE_KEY) {
    throw new Error("FIREBASE_KEY não encontrada.");
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

