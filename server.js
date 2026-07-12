require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

// ─── CORS ───────────────────────────────────────────────────────────────────
// Antes: origin: '*' (qualquer site podia chamar a API).
// Agora: só a lista abaixo pode chamar a partir de um navegador.
// Apps nativos (Flutter mobile) não mandam header "Origin", então não são
// afetados por essa checagem — isso é o comportamento normal de apps mobile,
// não uma brecha.
const origensPermitidas = [
  'https://conectapro-ff6d5.web.app',
  'https://conectapro-ff6d5.firebaseapp.com', // domínio alternativo padrão do Firebase Hosting
];

// `flutter run -d chrome` abre em localhost com uma porta aleatória a cada
// execução — em vez de cadastrar porta por porta, libera qualquer porta em
// localhost/127.0.0.1. É seguro: um navegador só manda "origin: localhost"
// quando a página realmente está rodando na própria máquina de quem acessa,
// ninguém de fora consegue forjar isso pra atacar outro usuário.
const localhostRegex = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

app.use(cors({
  origin: (origin, callback) => {
    // Sem "origin" = requisição não veio de navegador (app mobile, Postman, etc.)
    if (!origin || origensPermitidas.includes(origin) || localhostRegex.test(origin)) {
      callback(null, true);
    } else {
      console.warn('⚠️ CORS bloqueado para origem:', origin);
      callback(new Error('Origem não permitida pelo CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// ─── FIREBASE (não trava o servidor se não estiver configurado) ────────────
try {
  if (process.env.FIREBASE_KEY) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
    console.log("✅ Firebase conectado com sucesso");
  } else {
    console.log("⚠️ Firebase não configurado (modo teste)");
  }
} catch (err) {
  console.error("❌ Erro ao iniciar Firebase:", err.message);
}

// ─── RATE LIMITING ──────────────────────────────────────────────────────────
// Limite geral: protege o servidor como um todo contra flood de requisições.
const limiteGeral = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,                 // até 300 requisições por IP nessa janela
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas requisições. Tente novamente em alguns minutos.' },
});

// Limite apertado: rotas que mexem em saldo/dinheiro (carteira e pix) —
// aqui o risco de abuso (brute-force, spam de tentativa) é maior.
const limiteFinanceiro = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 20,                  // até 20 requisições por IP nessa janela
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Muitas tentativas. Aguarde alguns minutos antes de tentar de novo.' },
});

app.use(limiteGeral);

// ─── LOG DE REQUISIÇÕES ──────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`📡 ${req.method} ${req.url}`);
  next();
});

// ─── ROTAS ───────────────────────────────────────────────────────────────────
const pixRoutes = require('./routes/pix');
app.use('/pix', limiteFinanceiro, pixRoutes);

const carteiraRoutes = require('./routes/carteira');
app.use('/carteira', limiteFinanceiro, carteiraRoutes);

// 🔥 PEDIDOS (COMISSÃO)
const pedidosRoutes = require('./routes/pedidos');
app.use('/pedidos', pedidosRoutes);

// ─── TESTE ───────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('✅ Backend ConectaPro rodando');
});

// ─── PORTA ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
