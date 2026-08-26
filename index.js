require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

const app = express();

// Middleware CORS universel
app.use(cors());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialisation de Firebase Admin (Variable Vercel prioritaire)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("Erreur de parsing de FIREBASE_SERVICE_ACCOUNT:", err);
  }
} else {
  try {
    const serviceAccountPath = path.resolve(__dirname, 'serviceAccountKey.json');
    serviceAccount = require(serviceAccountPath);
  } catch (err) {
    console.warn("Fichier serviceAccountKey.json introuvable en local.");
  }
}

if (!admin.apps.length && serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.apps.length ? admin.firestore() : null;
const firestore = admin.firestore;

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'gbai_rai_secret_jwt_2026';
const TOKEN_EXPIRY = '8h';

// Middleware d'authentification
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, message: 'Accès refusé' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Session expirée' });
    req.user = user;
    next();
  });
}

function toResponseData(doc) {

  return { id: doc.id, ...doc.data() };
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

// Middleware pour vérifier l'accès à la BDD
app.use((req, res, next) => {
  if (!db) {
    return sendError(res, 500, "Base de données non configurée ou clé Firebase manquante.");
  }
  next();
});

// AUTHENTIFICATION ADMIN
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides' });
    }

    const adminConfigSnap = await db.collection('settings').doc('admin_config').get();
    const adminConfig = adminConfigSnap.exists ? adminConfigSnap.data() : {};
    const storedEmail = String(adminConfig.email || adminConfig.username || '').trim();
    const storedPassword = String(adminConfig.password || '').trim();

    if (String(email).trim().toLowerCase() !== storedEmail.toLowerCase() || String(password) !== storedPassword) {
      return res.status(401).json({ success: false, message: 'Identifiants invalides' });
    }

    const token = jwt.sign({ role: 'admin', email: String(email).trim().toLowerCase() }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    return res.json({ success: true, token, message: 'Connexion réussie.' });
  } catch (error) {
    console.error('Erreur login admin:', error);
    return res.status(500).json({ success: false, message: 'Erreur d’authentification.' });
  }
});

app.post('/api/admin/verify', (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'Jeton manquant' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) {
        return res.status(403).json({ success: false, message: 'Jeton invalide ou expiré' });
      }
      return res.json({ success: true, user });
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur de vérification' });
  }
});

// PARTICIPANTS
app.get('/api/participants', async (req, res) => {
  try {
    const snapshot = await db.collection('participants').get();
    const participants = snapshot.docs.map(toResponseData).sort((a, b) => (b.votes || 0) - (a.votes || 0));
    return res.json(participants);
  } catch (error) {
    console.error('Erreur lecture participants:', error);
    return sendError(res, 500, 'Erreur lecture participants.');
  }
});

app.post('/api/participants', authenticateToken, async (req, res) => {

  try {
    const { name, photo, gender } = req.body;
    if (!name || !gender) {
      return sendError(res, 400, 'Nom et genre requis.');
    }

    const participantRef = db.collection('participants').doc();
    const participantData = {
      name: String(name).trim(),
      photo: photo || '',
      gender,
      votes: 0,
      comments: [],
    };

    await participantRef.set(participantData);
    const saved = await participantRef.get();
    return res.status(201).json({ success: true, participant: toResponseData(saved) });
  } catch (error) {
    console.error('Erreur ajout participant:', error);
    return sendError(res, 500, 'Erreur ajout participant.');
  }
});

app.put('/api/participants/:id', authenticateToken, async (req, res) => {

  try {
    const participantRef = db.collection('participants').doc(req.params.id);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return sendError(res, 404, 'Participant introuvable.');
    }

    const { name, photo, gender } = req.body;
    const updateData = {};
    if (typeof name !== 'undefined') updateData.name = String(name).trim();
    if (typeof gender !== 'undefined') updateData.gender = gender;
    if (typeof photo !== 'undefined') updateData.photo = photo || '';

    await participantRef.update(updateData);
    const updatedSnap = await participantRef.get();
    return res.json({ success: true, participant: toResponseData(updatedSnap) });
  } catch (error) {
    console.error('Erreur modification participant:', error);
    return sendError(res, 500, 'Erreur modification participant.');
  }
});

app.delete('/api/participants/:id', authenticateToken, async (req, res) => {

  try {
    const participantRef = db.collection('participants').doc(req.params.id);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return sendError(res, 404, 'Participant introuvable.');
    }

    await participantRef.delete();
    return res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression participant:', error);
    return sendError(res, 500, 'Erreur suppression participant.');
  }
});

app.post('/api/votes', async (req, res) => {
  try {
    const { participantId } = req.body;
    if (!participantId) {
      return sendError(res, 400, 'participantId requis.');
    }

    const participantRef = db.collection('participants').doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return sendError(res, 404, 'Participant introuvable.');
    }

    await participantRef.update({ votes: firestore.FieldValue.increment(1) });
    const updatedSnap = await participantRef.get();
    return res.json({ success: true, votes: updatedSnap.data().votes });
  } catch (error) {
    console.error('Erreur vote:', error);
    return sendError(res, 500, 'Erreur vote.');
  }
});

app.post('/api/comments', async (req, res) => {
  try {
    const { participantId, text } = req.body;
    if (!participantId || !text || !String(text).trim()) {
      return sendError(res, 400, 'participantId et text requis.');
    }

    const participantRef = db.collection('participants').doc(participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return sendError(res, 404, 'Participant introuvable.');
    }

    const comment = {
      id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text: String(text).trim().slice(0, 500),
      createdAt: new Date().toISOString(),
    };

    await participantRef.update({ comments: firestore.FieldValue.arrayUnion(comment) });
    return res.json({ success: true, comment });
  } catch (error) {
    console.error('Erreur commentaire:', error);
    return sendError(res, 500, 'Erreur commentaire.');
  }
});

app.delete('/api/participants/:participantId/comments/:commentId', async (req, res) => {
  try {
    const participantRef = db.collection('participants').doc(req.params.participantId);
    const participantSnap = await participantRef.get();
    if (!participantSnap.exists) {
      return sendError(res, 404, 'Participant introuvable.');
    }

    const comments = participantSnap.data().comments || [];
    const commentToRemove = comments.find((comment) => comment.id === req.params.commentId);
    if (!commentToRemove) {
      return sendError(res, 404, 'Commentaire introuvable.');
    }

    await participantRef.update({ comments: firestore.FieldValue.arrayRemove(commentToRemove) });
    return res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression commentaire:', error);
    return sendError(res, 500, 'Erreur suppression commentaire.');
  }
});

// CONFIGURATION & RADIO
app.get('/api/content', async (req, res) => {
  try {
    const contentSnap = await db.collection('config').doc('general').get();
    return res.json({ success: true, content: contentSnap.exists ? contentSnap.data() : {} });
  } catch (error) {
    console.error('Erreur lecture content:', error);
    return sendError(res, 500, 'Erreur lecture content.');
  }
});

app.put('/api/content', authenticateToken, async (req, res) => {

  try {
    const payload = req.body || {};
    await db.collection('config').doc('general').set(payload, { merge: true });
    return res.json({ success: true, content: payload });
  } catch (error) {
    console.error('Erreur mise à jour content:', error);
    return sendError(res, 500, 'Erreur mise à jour content.');
  }
});

app.get('/api/radio', async (req, res) => {
  try {
    const radioSnap = await db.collection('config').doc('radio').get();
    return res.json({ success: true, radio: radioSnap.exists ? radioSnap.data() : { title: 'Radio', items: [] } });
  } catch (error) {
    console.error('Erreur lecture radio:', error);
    return sendError(res, 500, 'Erreur lecture radio.');
  }
});

app.put('/api/radio', authenticateToken, async (req, res) => {

  try {
    const payload = req.body || {};
    await db.collection('config').doc('radio').set(payload, { merge: true });
    return res.json({ success: true, radio: payload });
  } catch (error) {
    console.error('Erreur mise à jour radio:', error);
    return sendError(res, 500, 'Erreur mise à jour radio.');
  }
});

// SONDAGES FLASH & PROPOSITIONS
app.get('/api/sondages', async (req, res) => {
    try {
        const snapshot = await db.collection('sondages').get();
        let sondages = snapshot.docs.map(doc => toResponseData(doc));
        sondages.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.status(200).json({ success: true, data: sondages });
    } catch (error) {
        console.error("Erreur GET /api/sondages:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/sondages', authenticateToken, async (req, res) => {

    try {
        const { question, options } = req.body;
        if (!question || !options || !Array.isArray(options)) {
            return res.status(400).json({ success: false, message: "Question et options invalides." });
        }
        
        const formattedOptions = options.map(optText => ({
            text: String(optText),
            votes: 0
        }));

        const newSondage = {
            question: String(question).trim(),
            options: formattedOptions,
            active: true,
            createdAt: new Date().toISOString()
        };

        const docRef = await db.collection('sondages').add(newSondage);
        res.status(201).json({ success: true, id: docRef.id, message: "Sondage créé avec succès !" });
    } catch (error) {
        console.error("Erreur POST /api/sondages:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/sondages/:id/vote', async (req, res) => {
    try {
        const { id } = req.params;
        const { optionIndex } = req.body;

        const sondageRef = db.collection('sondages').doc(id);
        const doc = await sondageRef.get();

        if (!doc.exists) {
            return res.status(404).json({ success: false, message: "Sondage introuvable." });
        }

        const sondageData = doc.data();
        let options = sondageData.options || [];

        if (optionIndex === undefined || !options[optionIndex]) {
            return res.status(400).json({ success: false, message: "Option invalide." });
        }

        options[optionIndex].votes = (options[optionIndex].votes || 0) + 1;

        await sondageRef.update({ options: options });

        res.status(200).json({ success: true, message: "Vote enregistré avec succès !", options });
    } catch (error) {
        console.error("Erreur POST /api/sondages/:id/vote:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/sondages/:id', authenticateToken, async (req, res) => {

    try {
        const { id } = req.params;
        await db.collection('sondages').doc(id).delete();
        res.status(200).json({ success: true, message: "Sondage supprimé." });
    } catch (error) {
        console.error("Erreur DELETE /api/sondages/:id:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/sondages', authenticateToken, async (req, res) => {

    try {
        const snapshot = await db.collection('sondages').get();
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        res.status(200).json({ success: true, message: "Tous les sondages ont été supprimés." });
    } catch (error) {
        console.error("Erreur DELETE /api/sondages:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ROUTE PROPOSITIONS (PROPOSÉES PAR LE GRAND PUBLIC)
app.post('/api/sondages/proposer', async (req, res) => {
    try {
        const { question } = req.body;
        if (!question || !String(question).trim()) {
            return res.status(400).json({ success: false, message: "La question est requise." });
        }

        const newProposal = {
            question: String(question).trim(),
            createdAt: new Date().toISOString()
        };

        const docRef = await db.collection('propositions').add(newProposal);
        res.status(201).json({ success: true, id: docRef.id, message: "Proposition transmise à l'administrateur !" });
    } catch (error) {
        console.error("Erreur POST /api/sondages/proposer:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/admin/propositions', async (req, res) => {
    try {
        const snapshot = await db.collection('propositions').get();
        let propositions = snapshot.docs.map(doc => toResponseData(doc));
        propositions.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        res.status(200).json({ success: true, data: propositions });
    } catch (error) {
        console.error("Erreur GET /api/admin/propositions:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.delete('/api/admin/propositions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await db.collection('propositions').doc(id).delete();
        res.status(200).json({ success: true, message: "Proposition supprimée." });
    } catch (error) {
        console.error("Erreur DELETE /api/admin/propositions/:id:", error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ... (existing code ...)

// GAZETTE
app.get('/api/gazette', async (req, res) => {
  try {
    const snapshot = await db.collection('gazette').get();
    const articles = snapshot.docs.map(toResponseData).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ success: true, articles });
  } catch (error) {
    console.error('Erreur gazette:', error);
    return sendError(res, 500, 'Erreur lecture gazette.');
  }
});

app.post('/api/gazette', authenticateToken, async (req, res) => {

  try {
    const { title, content, image } = req.body;
    if (!title || !content) return sendError(res, 400, 'Titre et contenu requis.');
    const articleRef = db.collection('gazette').doc();
    const articleData = { title, content, image: image || '', createdAt: new Date().toISOString() };
    await articleRef.set(articleData);
    return res.status(201).json({ success: true, article: { id: articleRef.id, ...articleData } });
  } catch (error) {
    return sendError(res, 500, 'Erreur création article.');
  }
});

app.delete('/api/gazette/:id', authenticateToken, async (req, res) => {

  try {
    await db.collection('gazette').doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, 500, 'Erreur suppression article.');
  }
});

// ANNONCES
app.get('/api/annonces', async (req, res) => {
  try {
    const snapshot = await db.collection('annonces').get();
    const annonces = snapshot.docs.map(toResponseData).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ success: true, annonces });
  } catch (error) {
    return sendError(res, 500, 'Erreur lecture annonces.');
  }
});

app.post('/api/annonces', async (req, res) => {
  try {
    const { title, description, price, contact, category, image } = req.body;
    if (!title || !contact) return sendError(res, 400, 'Titre et contact requis.');
    const annonceRef = db.collection('annonces').doc();
    const annonceData = { title, description, price, contact, category, image: image || '', createdAt: new Date().toISOString() };
    await annonceRef.set(annonceData);
    return res.status(201).json({ success: true, annonce: { id: annonceRef.id, ...annonceData } });
  } catch (error) {
    return sendError(res, 500, 'Erreur création annonce.');
  }
});

app.delete('/api/annonces/:id', authenticateToken, async (req, res) => {

  try {
    await db.collection('annonces').doc(req.params.id).delete();
    return res.json({ success: true });
  } catch (error) {
    return sendError(res, 500, 'Erreur suppression annonce.');
  }
});

// CONFESSIONS
app.get('/api/confessions', async (req, res) => {
  try {
    const snapshot = await db.collection('confessions').get();
    const confessions = snapshot.docs.map(toResponseData).sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    return res.json({ success: true, confessions });
  } catch (error) {
    return sendError(res, 500, 'Erreur lecture confessions.');
  }
});

app.post('/api/confessions', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return sendError(res, 400, 'Texte requis.');
    const confessionRef = db.collection('confessions').doc();
    const confessionData = { text, createdAt: new Date().toISOString(), likes: 0 };
    await confessionRef.set(confessionData);
    return res.status(201).json({ success: true, confession: { id: confessionRef.id, ...confessionData } });
  } catch (error) {
    return sendError(res, 500, 'Erreur création confession.');
  }
});

// CLASSEMENT (déjà existant, on s'assure qu'il est là)
// ...


// Écoute locale
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Serveur prêt sur le port ${PORT}`);
  });
}

module.exports = app;
