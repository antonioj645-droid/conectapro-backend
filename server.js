require('dotenv').config();

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

// ✅ 🔥 ESSA LINHA É OBRIGATÓRIA NO RENDER
app.set('trust proxy', 1);

// =========================
// ✅ CORS (CORRIGIDO TOTAL)
// =========================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ✅ ESSENCIAL PRO FLUTTER WEB
app.options('*', cors());

app.use(express.json());

// =========================
// ✅ FIREBASE
// =========================
try {

  if (!process.env.FIREBASE_KEY) {
    throw new Error("FIREBASE_KEY não encontrada.");
  }

  const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

  if (!admin.apps.length) {
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
// ✅ ROTAS
// =========================

// ✅ Pix
const pixRoutes = require('./routes/pix');
app.use('/pix', pixRoutes);

// ✅ Carteira (DESBLOQUEAR)
const carteiraRoutes = require('./routes/carteira');
app.use('/carteira', carteiraRoutes);

// =========================
// ✅ ROTA TESTE
// =========================
app.get('/', (req, res) => {
  res.send('✅ Backend ConectaPro rodando');
});

// =========================
// ✅ DEBUG (OPCIONAL - PODE DEIXAR)
// =========================
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// =========================
// ✅ PORTA
// =========================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});