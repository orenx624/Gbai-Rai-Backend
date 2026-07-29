require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const JWT_SECRET = process.env.JWT_SECRET || 'gbai_rai_secret_jwt_2026';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_EXPIRY = '8h';
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gbai-rai';

const commentSchema = new mongoose.Schema({
  text: { type: String, required: true },
  time: { type: String, required: true },
}, { _id: false });

const participantSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  name: { type: String, required: true, trim: true },
  gender: { type: String, required: true, trim: true },
  photo: { type: String, default: '' },
  votes: { type: Number, default: 0 },
  comments: [commentSchema],
}, { timestamps: true });

const radioItemSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, trim: true },
  text: { type: String, required: true, trim: true },
}, { timestamps: true });

const Participant = mongoose.model('Participant', participantSchema);
const RadioItem = mongoose.model('RadioItem', radioItemSchema);

function verifyAdminToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Token manquant. Authentification requise.' });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré. Reconnectez-vous.' });
  }
}

async function seedInitialData() {
  const participantCount = await Participant.countDocuments();
  if (participantCount === 0) {
    await Participant.create([
      { id: 'p1', name: 'Amina', gender: 'F', photo: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p2', name: 'Moussa', gender: 'M', photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p3', name: 'Seydou', gender: 'M', photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p4', name: 'Rita', gender: 'F', photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p5', name: 'Fabrice', gender: 'M', photo: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p6', name: 'Nadia', gender: 'F', photo: 'https://images.unsplash.com/photo-1507120410856-1f35574c3b45?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p7', name: 'David', gender: 'M', photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
      { id: 'p8', name: 'Leila', gender: 'F', photo: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    ]);
  }

  const radioCount = await RadioItem.countDocuments();
  if (radioCount === 0) {
    await RadioItem.create([
      { id: 'radio-1', text: 'Un nouveau duel a été lancé au campus et tout le monde veut voter avant la fin de la journée.' },
      { id: 'radio-2', text: 'Les rumeurs les plus chaudes circulent déjà dans les couloirs, et la radio couloir les relaye en temps réel.' },
    ]);
  }
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ success: false, message: 'Mot de passe requis.' });
  }
  if (password !== ADMIN_PASS) {
    return res.status(401).json({ success: false, message: 'Mot de passe incorrect.' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
  res.json({ success: true, token });
});

app.get('/api/participants', async (req, res) => {
  try {
    const participants = await Participant.find().sort({ votes: -1, createdAt: 1 });
    res.json(participants);
  } catch (error) {
    console.error('Erreur lecture participants:', error);
    res.status(500).json({ success: false, message: 'Erreur lecture participants.' });
  }
});

app.get('/api/classement', async (req, res) => {
  try {
    const participants = await Participant.find().sort({ votes: -1, createdAt: 1 });
    const sorted = participants.slice().sort((a, b) => (b.votes || 0) - (a.votes || 0));
    res.json({ top: sorted.slice(0, 10), queen: sorted[0] || null });
  } catch (error) {
    console.error('Erreur classement:', error);
    res.status(500).json({ success: false, message: 'Erreur classement.' });
  }
});

app.post('/api/vote', async (req, res) => {
  try {
    const { participantId } = req.body;
    if (!participantId) {
      return res.status(400).json({ success: false, message: 'participantId requis.' });
    }

    const participant = await Participant.findOne({ $or: [{ _id: participantId }, { id: participantId }] });
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });
    }

    participant.votes += 1;
    await participant.save();
    res.json({ success: true, votes: participant.votes });
  } catch (error) {
    console.error('Erreur vote:', error);
    res.status(500).json({ success: false, message: 'Erreur vote.' });
  }
});

app.post('/api/comment', async (req, res) => {
  try {
    const { participantId, text } = req.body;
    if (!participantId || !text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'participantId et text requis.' });
    }

    const participant = await Participant.findOne({ $or: [{ _id: participantId }, { id: participantId }] });
    if (!participant) {
      return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });
    }

    const comment = {
      text: text.trim().slice(0, 500),
      time: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
    };
    participant.comments.push(comment);
    await participant.save();
    res.json({ success: true, comment });
  } catch (error) {
    console.error('Erreur commentaire:', error);
    res.status(500).json({ success: false, message: 'Erreur commentaire.' });
  }
});

app.post('/api/participants', verifyAdminToken, async (req, res) => {
  try {
    const { name, gender, photo } = req.body;
    if (!name || !gender) {
      return res.status(400).json({ success: false, message: 'Nom et genre requis.' });
    }

    let finalPhotoUrl = photo || '';

    if (photo && photo.startsWith('data:image')) {
      const uploadRes = await cloudinary.uploader.upload(photo, {
        folder: 'gbai_rai_participants',
        transformation: [{ width: 800, height: 800, crop: 'fill', gravity: 'face', quality: 'auto' }],
      });
      finalPhotoUrl = uploadRes.secure_url;
    }

    const newParticipant = await Participant.create({
      id: `p${Date.now()}${Math.floor(Math.random() * 1000)}`,
      name: name.trim().slice(0, 60),
      gender,
      photo: finalPhotoUrl,
      votes: 0,
      comments: [],
    });

    res.json({ success: true, participant: newParticipant });
  } catch (error) {
    console.error('Erreur ajout candidat:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'ajout du candidat." });
  }
});

app.put('/api/participants/:id', verifyAdminToken, async (req, res) => {
  try {
    const participant = await Participant.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
    if (!participant) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

    const { name, gender, photo } = req.body;
    if (name) participant.name = name.trim().slice(0, 60);
    if (gender) participant.gender = gender;

    if (photo && photo.startsWith('data:image')) {
      const uploadRes = await cloudinary.uploader.upload(photo, {
        folder: 'gbai_rai_participants',
        transformation: [{ width: 800, height: 800, crop: 'fill', gravity: 'face', quality: 'auto' }],
      });
      participant.photo = uploadRes.secure_url;
    } else if (photo) {
      participant.photo = photo;
    }

    await participant.save();
    res.json({ success: true, participant });
  } catch (error) {
    console.error('Erreur modification candidat:', error);
    res.status(500).json({ success: false, message: 'Erreur modification candidat.' });
  }
});

app.patch('/api/participants/:id/votes', verifyAdminToken, async (req, res) => {
  try {
    const participant = await Participant.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
    if (!participant) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

    const newVotes = parseInt(req.body.votes, 10);
    if (isNaN(newVotes) || newVotes < 0) {
      return res.status(400).json({ success: false, message: 'La valeur des votes doit être un entier ≥ 0.' });
    }

    participant.votes = newVotes;
    await participant.save();
    res.json({ success: true, participant });
  } catch (error) {
    console.error('Erreur mise à jour votes:', error);
    res.status(500).json({ success: false, message: 'Erreur mise à jour votes.' });
  }
});

app.delete('/api/participants/:id', verifyAdminToken, async (req, res) => {
  try {
    const participant = await Participant.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
    if (!participant) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

    await participant.deleteOne();
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression candidat:', error);
    res.status(500).json({ success: false, message: 'Erreur suppression candidat.' });
  }
});

app.delete('/api/participants/:id/comments/:index', verifyAdminToken, async (req, res) => {
  try {
    const participant = await Participant.findOne({ $or: [{ _id: req.params.id }, { id: req.params.id }] });
    if (!participant) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0 || index >= participant.comments.length) {
      return res.status(400).json({ success: false, message: 'Index de commentaire invalide.' });
    }

    participant.comments.splice(index, 1);
    await participant.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression commentaire:', error);
    res.status(500).json({ success: false, message: 'Erreur suppression commentaire.' });
  }
});

app.post('/api/admin/reset-votes', verifyAdminToken, async (req, res) => {
  try {
    await Participant.updateMany({}, { votes: 0 });
    res.json({ success: true, message: 'Tous les votes ont été réinitialisés.' });
  } catch (error) {
    console.error('Erreur reset votes:', error);
    res.status(500).json({ success: false, message: 'Erreur reset votes.' });
  }
});

app.post('/api/admin/clear-comments', verifyAdminToken, async (req, res) => {
  try {
    await Participant.updateMany({}, { comments: [] });
    res.json({ success: true, message: 'Tous les commentaires ont été supprimés.' });
  } catch (error) {
    console.error('Erreur clear comments:', error);
    res.status(500).json({ success: false, message: 'Erreur clear comments.' });
  }
});

app.get('/api/radio', async (req, res) => {
  try {
    const radioItems = await RadioItem.find().sort({ createdAt: 1 });
    res.json(radioItems);
  } catch (error) {
    console.error('Erreur lecture radio:', error);
    res.status(500).json({ success: false, message: 'Erreur lecture radio.' });
  }
});

app.post('/api/radio', verifyAdminToken, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Le texte est requis.' });
    }

    const item = await RadioItem.create({
      id: 'radio-' + Date.now(),
      text: text.trim(),
    });
    res.json({ success: true, item });
  } catch (error) {
    console.error('Erreur ajout radio:', error);
    res.status(500).json({ success: false, message: 'Erreur ajout radio.' });
  }
});

app.delete('/api/radio/:id', verifyAdminToken, async (req, res) => {
  try {
    await RadioItem.deleteOne({ id: req.params.id });
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur suppression radio:', error);
    res.status(500).json({ success: false, message: 'Erreur suppression radio.' });
  }
});

async function startServer() {
  if (MONGODB_URI) {
    try {
      await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
      console.log('Connexion MongoDB établie.');
      await seedInitialData();
    } catch (error) {
      console.warn(`Connexion MongoDB impossible: ${error.message}`);
      console.warn('Le serveur continue avec les routes actives, mais les données ne seront pas persistées tant que la base n\'est pas accessible.');
    }
  } else {
    console.warn('MONGODB_URI non défini. Le serveur démarre sans persistance MongoDB.');
  }

  app.listen(PORT, () => {
    console.log(`Serveur Gbai-Rai démarré sur le port ${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Erreur démarrage serveur:', error);
  process.exit(1);
});
