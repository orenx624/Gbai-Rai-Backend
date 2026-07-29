require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const JWT_SECRET   = process.env.JWT_SECRET || 'gbai_rai_secret_jwt_2026';
const ADMIN_PASS   = process.env.ADMIN_PASSWORD || 'admin123';
const TOKEN_EXPIRY = '8h';

const db = {
  participants: [
    { id: 'p1', name: 'Amina',   gender: 'F', photo: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p2', name: 'Moussa',  gender: 'M', photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p3', name: 'Seydou',  gender: 'M', photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p4', name: 'Rita',    gender: 'F', photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p5', name: 'Fabrice', gender: 'M', photo: 'https://images.unsplash.com/photo-1527980965255-d3b416303d12?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p6', name: 'Nadia',   gender: 'F', photo: 'https://images.unsplash.com/photo-1507120410856-1f35574c3b45?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p7', name: 'David',   gender: 'M', photo: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
    { id: 'p8', name: 'Leila',   gender: 'F', photo: 'https://images.unsplash.com/photo-1502685104226-ee32379fefbe?auto=format&fit=crop&w=800&q=80', votes: 0, comments: [] },
  ],
  radioItems: [
    { id: 'radio-1', text: 'Un nouveau duel a été lancé au campus et tout le monde veut voter avant la fin de la journée.' },
    { id: 'radio-2', text: 'Les rumeurs les plus chaudes circulent déjà dans les couloirs, et la radio couloir les relaye en temps réel.' },
  ],

  getParticipants()        { return this.participants; },
  findParticipant(id)      { return this.participants.find(p => p.id === id); },
  addParticipant(p)        { this.participants.push(p); },
  removeParticipant(id)    { this.participants = this.participants.filter(p => p.id !== id); },
  getRadioItems()          { return this.radioItems; },
  addRadioItem(item)       { this.radioItems.push(item); },
  removeRadioItem(id)      { this.radioItems = this.radioItems.filter(r => r.id !== id); },
};

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

app.get('/api/participants', (req, res) => {
  res.json(db.getParticipants());
});

app.get('/api/classement', (req, res) => {
  const sorted = db.getParticipants().slice().sort((a, b) => (b.votes || 0) - (a.votes || 0));
  res.json({ top: sorted.slice(0, 10), queen: sorted[0] || null });
});

app.post('/api/vote', (req, res) => {
  const { participantId } = req.body;
  if (!participantId) {
    return res.status(400).json({ success: false, message: 'participantId requis.' });
  }
  const p = db.findParticipant(participantId);
  if (!p) {
    return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });
  }
  p.votes += 1;
  res.json({ success: true, votes: p.votes });
});

app.post('/api/comment', (req, res) => {
  const { participantId, text } = req.body;
  if (!participantId || !text || !text.trim()) {
    return res.status(400).json({ success: false, message: 'participantId et text requis.' });
  }
  const p = db.findParticipant(participantId);
  if (!p) {
    return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });
  }
  const comment = {
    text: text.trim().slice(0, 500),
    time: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  };
  p.comments.push(comment);
  res.json({ success: true, comment });
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

    const newParticipant = {
      id:       'p' + Date.now(),
      name:     name.trim().slice(0, 60),
      gender,
      photo:    finalPhotoUrl,
      votes:    0,
      comments: [],
    };

    db.addParticipant(newParticipant);
    res.json({ success: true, participant: newParticipant });
  } catch (error) {
    console.error('Erreur ajout candidat:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'ajout du candidat." });
  }
});

app.put('/api/participants/:id', verifyAdminToken, async (req, res) => {
  const p = db.findParticipant(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

  const { name, gender, photo } = req.body;
  if (name)   p.name   = name.trim().slice(0, 60);
  if (gender) p.gender = gender;

  if (photo && photo.startsWith('data:image')) {
    try {
      const uploadRes = await cloudinary.uploader.upload(photo, {
        folder: 'gbai_rai_participants',
        transformation: [{ width: 800, height: 800, crop: 'fill', gravity: 'face', quality: 'auto' }],
      });
      p.photo = uploadRes.secure_url;
    } catch (e) {
      return res.status(500).json({ success: false, message: "Erreur upload Cloudinary." });
    }
  } else if (photo) {
    p.photo = photo;
  }

  res.json({ success: true, participant: p });
});

app.patch('/api/participants/:id/votes', verifyAdminToken, (req, res) => {
  const p = db.findParticipant(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

  const newVotes = parseInt(req.body.votes, 10);
  if (isNaN(newVotes) || newVotes < 0) {
    return res.status(400).json({ success: false, message: 'La valeur des votes doit être un entier ≥ 0.' });
  }

  p.votes = newVotes;
  res.json({ success: true, participant: p });
});

app.delete('/api/participants/:id', verifyAdminToken, (req, res) => {
  const p = db.findParticipant(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

  db.removeParticipant(req.params.id);
  res.json({ success: true });
});

app.delete('/api/participants/:id/comments/:index', verifyAdminToken, (req, res) => {
  const p = db.findParticipant(req.params.id);
  if (!p) return res.status(404).json({ success: false, message: 'Candidat non trouvé.' });

  const index = parseInt(req.params.index, 10);
  if (isNaN(index) || index < 0 || index >= p.comments.length) {
    return res.status(400).json({ success: false, message: 'Index de commentaire invalide.' });
  }

  p.comments.splice(index, 1);
  res.json({ success: true });
});

app.post('/api/admin/reset-votes', verifyAdminToken, (req, res) => {
  db.getParticipants().forEach(p => { p.votes = 0; });
  res.json({ success: true, message: 'Tous les votes ont été réinitialisés.' });
});

app.post('/api/admin/clear-comments', verifyAdminToken, (req, res) => {
  db.getParticipants().forEach(p => { p.comments = []; });
  res.json({ success: true, message: 'Tous les commentaires ont été supprimés.' });
});

app.get('/api/radio', (req, res) => {
  res.json(db.getRadioItems());
});

app.post('/api/radio', verifyAdminToken, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ success: false, message: 'Le texte est requis.' });
  }
  const item = { id: 'radio-' + Date.now(), text: text.trim() };
  db.addRadioItem(item);
  res.json({ success: true, item });
});

app.delete('/api/radio/:id', verifyAdminToken, (req, res) => {
  db.removeRadioItem(req.params.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur Gbai-Rai démarré sur le port ${PORT}`);
});
