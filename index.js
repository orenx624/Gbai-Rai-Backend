require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  const serviceAccountPath = path.resolve(__dirname, 'serviceAccountKey.json');
  serviceAccount = require(serviceAccountPath);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const firestore = admin.firestore;

const PORT = process.env.PORT || 5000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@gbai-rai.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'GbaiRai_2026!Admin#SecurePass';
const JWT_SECRET = process.env.JWT_SECRET || 'gbai_rai_secret_jwt_2026';
const TOKEN_EXPIRY = '8h';

function toResponseData(doc) {
  return { id: doc.id, ...doc.data() };
}

function sendError(res, status, message) {
  return res.status(status).json({ success: false, message });
}

async function seedInitialData() {
  const participantsSnapshot = await db.collection('participants').limit(1).get();
  if (participantsSnapshot.empty) {
    const batch = db.batch();
    const sampleParticipants = [
      { name: 'Amina', gender: 'F', photo: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { name: 'Moussa', gender: 'M', photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { name: 'Seydou', gender: 'M', photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { name: 'Rita', gender: 'F', photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    ];

    sampleParticipants.forEach((participant) => {
      batch.set(db.collection('participants').doc(), participant);
    });
    await batch.commit();
  }

  const generalConfigRef = db.collection('config').doc('general');
  const generalConfigSnap = await generalConfigRef.get();
  if (!generalConfigSnap.exists) {
    await generalConfigRef.set({
      title: 'Gbai-Rai',
      subtitle: 'Bienvenue',
      description: 'Découvrez les participants du concours.',
    });
  }

  const radioConfigRef = db.collection('config').doc('radio');
  const radioConfigSnap = await radioConfigRef.get();
  if (!radioConfigSnap.exists) {
    await radioConfigRef.set({ title: 'Radio', items: [] });
  }
}

app.post('/api/admin/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return sendError(res, 400, 'Email et mot de passe requis.');
    }

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return sendError(res, 401, 'Identifiants invalides.');
    }

    const token = jwt.sign({ role: 'admin', email }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    return res.json({ success: true, token, message: 'Connexion réussie.' });
  } catch (error) {
    console.error('Erreur login admin:', error);
    return sendError(res, 500, 'Erreur d’authentification.');
  }
});

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

app.post('/api/participants', async (req, res) => {
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

app.put('/api/participants/:id', async (req, res) => {
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

app.delete('/api/participants/:id', async (req, res) => {
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

app.get('/api/content', async (req, res) => {
  try {
    const contentSnap = await db.collection('config').doc('general').get();
    return res.json({ success: true, content: contentSnap.exists ? contentSnap.data() : {} });
  } catch (error) {
    console.error('Erreur lecture content:', error);
    return sendError(res, 500, 'Erreur lecture content.');
  }
});

app.put('/api/content', async (req, res) => {
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

app.put('/api/radio', async (req, res) => {
  try {
    const payload = req.body || {};
    await db.collection('config').doc('radio').set(payload, { merge: true });
    return res.json({ success: true, radio: payload });
  } catch (error) {
    console.error('Erreur mise à jour radio:', error);
    return sendError(res, 500, 'Erreur mise à jour radio.');
  }
});

app.get('/api/classement', async (req, res) => {
  try {
    const snapshot = await db.collection('participants').get();
    const participants = snapshot.docs.map(toResponseData).sort((a, b) => (b.votes || 0) - (a.votes || 0));
    return res.json({ success: true, top: participants.slice(0, 10), queen: participants[0] || null });
  } catch (error) {
    console.error('Erreur classement:', error);
    return sendError(res, 500, 'Erreur classement.');
  }
});

async function startServer() {
  await seedInitialData();
  app.listen(PORT, () => {
    console.log(`Serveur Gbai-Rai prêt sur le port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Erreur démarrage serveur:', error);
  process.exit(1);
});

module.exports = app;
