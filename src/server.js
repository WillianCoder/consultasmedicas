process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const SqliteStore = require('./sessionStore');
const { pendingReminders, whatsappLink, formatDateTime } = require('./reminders');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  store: new SqliteStore(),
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 },
}));

const STATUSES = ['agendada', 'confirmada', 'realizada', 'cancelada', 'remarcada'];
const OPTIONAL_PROFILE = ['birth_date', 'blood_type', 'allergies', 'insurance', 'insurance_number', 'emergency_contact'];
const clean = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

// Carrega o usuário logado e dados comuns para todas as telas
app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.pendingCount = 0;
  res.locals.formatDateTime = formatDateTime;
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  if (req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) {
      req.user = res.locals.user = user;
      if (user.role === 'admin') res.locals.pendingCount = pendingReminders().length;
    }
  }
  next();
});

const requireLogin = (req, res, next) => (req.user ? next() : res.redirect('/login'));
const requireAdmin = (req, res, next) =>
  req.user?.role === 'admin' ? next() : res.status(403).render('error', { message: 'Apenas o admin pode acessar esta página.' });
const flash = (req, msg) => { req.session.flash = msg; };

// ---------- Cadastro e login ----------
app.get('/cadastro', (req, res) => res.render('register', { form: {}, error: null }));

app.post('/cadastro', (req, res) => {
  const form = req.body;
  const name = clean(form.name), email = clean(form.email)?.toLowerCase(), whatsapp = clean(form.whatsapp);
  const error =
    !name || !email || !whatsapp || !form.password ? 'Preencha nome, e-mail, senha e WhatsApp.'
    : form.password.length < 6 ? 'A senha deve ter pelo menos 6 caracteres.'
    : db.prepare('SELECT 1 FROM users WHERE email = ?').get(email) ? 'Este e-mail já está cadastrado.'
    : null;
  if (error) return res.render('register', { form, error });

  // A primeira pessoa cadastrada vira admin
  const isFirst = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
  const result = db.prepare(`INSERT INTO users (name, email, password_hash, whatsapp, role, ${OPTIONAL_PROFILE.join(', ')})
    VALUES (?, ?, ?, ?, ?, ${OPTIONAL_PROFILE.map(() => '?').join(', ')})`)
    .run(name, email, bcrypt.hashSync(form.password, 10), whatsapp, isFirst ? 'admin' : 'membro',
      ...OPTIONAL_PROFILE.map((f) => clean(form[f])));

  req.session.regenerate(() => {
    req.session.userId = Number(result.lastInsertRowid);
    flash(req, isFirst ? 'Conta criada! Você é o admin da família.' : 'Conta criada com sucesso!');
    res.redirect('/');
  });
});

app.get('/login', (req, res) => res.render('login', { error: null, email: '' }));

app.post('/login', (req, res) => {
  const email = clean(req.body.email)?.toLowerCase() || '';
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    return res.render('login', { error: 'E-mail ou senha incorretos.', email });
  }
  req.session.regenerate(() => {
    req.session.userId = user.id;
    res.redirect('/');
  });
});

app.post('/sair', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------- Início ----------
app.get('/', requireLogin, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const appointments = db.prepare(`
    SELECT a.*, u.name AS patient, d.name AS doctor
    FROM appointments a JOIN users u ON u.id = a.user_id LEFT JOIN doctors d ON d.id = a.doctor_id
    WHERE a.date_time >= ? AND a.status NOT IN ('cancelada', 'realizada') ${isAdmin ? '' : 'AND a.user_id = ?'}
    ORDER BY a.date_time LIMIT 10`)
    .all(...[localNow(), ...(isAdmin ? [] : [req.user.id])]);
  res.render('home', { appointments });
});

// ---------- Perfil ----------
app.get('/perfil', requireLogin, (req, res) => res.render('profile', { form: req.user, error: null }));

app.post('/perfil', requireLogin, (req, res) => {
  const form = req.body;
  const name = clean(form.name), whatsapp = clean(form.whatsapp);
  if (!name || !whatsapp) return res.render('profile', { form: { ...req.user, ...form }, error: 'Nome e WhatsApp são obrigatórios.' });
  db.prepare(`UPDATE users SET name = ?, whatsapp = ?, ${OPTIONAL_PROFILE.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
    .run(name, whatsapp, ...OPTIONAL_PROFILE.map((f) => clean(form[f])), req.user.id);
  if (form.password) {
    if (form.password.length < 6) return res.render('profile', { form: { ...req.user, ...form }, error: 'A nova senha deve ter pelo menos 6 caracteres.' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(form.password, 10), req.user.id);
  }
  flash(req, 'Perfil atualizado.');
  res.redirect('/perfil');
});

// ---------- Consultas ----------
function localNow() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function canEdit(user, appt) {
  return appt && (user.role === 'admin' || appt.user_id === user.id);
}

function formData(req) {
  return {
    doctors: db.prepare('SELECT * FROM doctors ORDER BY name').all(),
    members: req.user.role === 'admin' ? db.prepare('SELECT id, name FROM users ORDER BY name').all() : [req.user],
    statuses: STATUSES,
  };
}

app.get('/consultas', requireLogin, (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const filter = req.query.filtro === 'passadas' ? 'passadas' : 'proximas';
  const memberId = isAdmin && req.query.membro ? Number(req.query.membro) : null;
  const where = [filter === 'proximas' ? 'a.date_time >= ?' : 'a.date_time < ?'];
  const params = [localNow()];
  if (!isAdmin) { where.push('a.user_id = ?'); params.push(req.user.id); }
  else if (memberId) { where.push('a.user_id = ?'); params.push(memberId); }
  const appointments = db.prepare(`
    SELECT a.*, u.name AS patient, d.name AS doctor
    FROM appointments a JOIN users u ON u.id = a.user_id LEFT JOIN doctors d ON d.id = a.doctor_id
    WHERE ${where.join(' AND ')} ORDER BY a.date_time ${filter === 'proximas' ? 'ASC' : 'DESC'}`).all(...params);
  const members = isAdmin ? db.prepare('SELECT id, name FROM users ORDER BY name').all() : [];
  res.render('appointments', { appointments, filter, members, memberId });
});

app.get('/consultas/nova', requireLogin, (req, res) =>
  res.render('appointment_form', { ...formData(req), appt: { user_id: req.user.id, remind_days_before: 1, status: 'agendada' }, error: null }));

function readAppointment(req) {
  const b = req.body;
  const userId = req.user.role === 'admin' ? Number(b.user_id) : req.user.id;
  return {
    user_id: userId,
    doctor_id: b.doctor_id ? Number(b.doctor_id) : null,
    specialty: clean(b.specialty),
    date_time: clean(b.date_time),
    location: clean(b.location),
    reason: clean(b.reason),
    bring: clean(b.bring),
    status: STATUSES.includes(b.status) ? b.status : 'agendada',
    remind_days_before: Math.max(0, Math.min(30, Number(b.remind_days_before) || 0)),
  };
}

app.post('/consultas', requireLogin, (req, res) => {
  const a = readAppointment(req);
  if (!a.date_time || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(a.user_id)) {
    return res.render('appointment_form', { ...formData(req), appt: a, error: 'Informe o paciente e a data/hora.' });
  }
  db.prepare(`INSERT INTO appointments (user_id, doctor_id, specialty, date_time, location, reason, bring, status, remind_days_before)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.user_id, a.doctor_id, a.specialty, a.date_time, a.location, a.reason, a.bring, a.status, a.remind_days_before);
  flash(req, 'Consulta cadastrada.');
  res.redirect('/consultas');
});

app.get('/consultas/:id/editar', requireLogin, (req, res) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!canEdit(req.user, appt)) return res.status(404).render('error', { message: 'Consulta não encontrada.' });
  res.render('appointment_form', { ...formData(req), appt, error: null });
});

app.post('/consultas/:id', requireLogin, (req, res) => {
  const old = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!canEdit(req.user, old)) return res.status(404).render('error', { message: 'Consulta não encontrada.' });
  const a = readAppointment(req);
  if (!a.date_time) return res.render('appointment_form', { ...formData(req), appt: { ...a, id: old.id }, error: 'Informe a data/hora.' });
  // Se mudou a data ou o prazo do lembrete, o lembrete volta a ficar pendente
  const resetReminder = a.date_time !== old.date_time || a.remind_days_before !== old.remind_days_before;
  db.prepare(`UPDATE appointments SET user_id = ?, doctor_id = ?, specialty = ?, date_time = ?, location = ?, reason = ?, bring = ?,
    status = ?, remind_days_before = ?, reminder_sent_at = ? WHERE id = ?`)
    .run(a.user_id, a.doctor_id, a.specialty, a.date_time, a.location, a.reason, a.bring, a.status, a.remind_days_before,
      resetReminder ? null : old.reminder_sent_at, old.id);
  flash(req, 'Consulta atualizada.');
  res.redirect('/consultas');
});

app.post('/consultas/:id/excluir', requireLogin, (req, res) => {
  const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(req.params.id);
  if (!canEdit(req.user, appt)) return res.status(404).render('error', { message: 'Consulta não encontrada.' });
  db.prepare('DELETE FROM appointments WHERE id = ?').run(appt.id);
  flash(req, 'Consulta excluída.');
  res.redirect('/consultas');
});

// ---------- Médicos ----------
app.get('/medicos', requireLogin, (req, res) =>
  res.render('doctors', { doctors: db.prepare('SELECT * FROM doctors ORDER BY name').all(), error: null }));

app.post('/medicos', requireLogin, (req, res) => {
  const b = req.body;
  if (!clean(b.name)) {
    return res.render('doctors', { doctors: db.prepare('SELECT * FROM doctors ORDER BY name').all(), error: 'Informe o nome do médico.' });
  }
  db.prepare('INSERT INTO doctors (name, specialty, crm, phone, address, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(clean(b.name), clean(b.specialty), clean(b.crm), clean(b.phone), clean(b.address), req.user.id);
  flash(req, 'Médico cadastrado.');
  res.redirect(b.voltar === 'consulta' ? '/consultas/nova' : '/medicos');
});

app.post('/medicos/:id/excluir', requireLogin, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM doctors WHERE id = ?').run(req.params.id);
  flash(req, 'Médico excluído.');
  res.redirect('/medicos');
});

// ---------- Lembretes (só admin) ----------
app.get('/lembretes', requireLogin, requireAdmin, (req, res) => {
  const pending = pendingReminders().map((r) => ({ ...r, link: whatsappLink(r) }));
  const sent = db.prepare(`
    SELECT a.*, u.name AS patient, d.name AS doctor FROM appointments a
    JOIN users u ON u.id = a.user_id LEFT JOIN doctors d ON d.id = a.doctor_id
    WHERE a.reminder_sent_at IS NOT NULL ORDER BY a.reminder_sent_at DESC LIMIT 30`).all();
  res.render('reminders', { pending, sent });
});

app.post('/lembretes/:id/enviado', requireLogin, requireAdmin, (req, res) => {
  db.prepare("UPDATE appointments SET reminder_sent_at = datetime('now', 'localtime') WHERE id = ?").run(req.params.id);
  flash(req, 'Lembrete marcado como enviado.');
  res.redirect('/lembretes');
});

app.post('/lembretes/:id/desfazer', requireLogin, requireAdmin, (req, res) => {
  db.prepare('UPDATE appointments SET reminder_sent_at = NULL WHERE id = ?').run(req.params.id);
  res.redirect('/lembretes');
});

// ---------- Membros (só admin) ----------
app.get('/membros', requireLogin, requireAdmin, (req, res) =>
  res.render('members', { members: db.prepare('SELECT * FROM users ORDER BY name').all() }));

app.post('/membros/:id/papel', requireLogin, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const role = req.body.role === 'admin' ? 'admin' : 'membro';
  const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
  const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
  if (target?.role === 'admin' && role === 'membro' && admins <= 1) {
    flash(req, 'A família precisa ter pelo menos um admin.');
  } else {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    flash(req, 'Permissão atualizada.');
  }
  res.redirect('/membros');
});

app.use((req, res) => res.status(404).render('error', { message: 'Página não encontrada.' }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Consultas Médicas rodando em http://localhost:${PORT}`));
}
module.exports = app;
