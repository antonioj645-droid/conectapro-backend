require('dotenv').config();

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

app.set('trust proxy', 1);

// ✅ CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ✅ FIREBASE
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

// ✅ LOG
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// ✅ ROTAS
const pixRoutes = require('./routes/pix');
app.use('/pix', pixRoutes);

const carteiraRoutes = require('./routes/carteira');
app.use('/carteira', carteiraRoutes);

// ✅ TESTE
app.get('/', (req, res) => {
  res.send('✅ Backend ConectaPro rodando');
});

// ✅ PORTA
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
