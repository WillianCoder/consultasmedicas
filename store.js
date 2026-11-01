// Camada de dados com dois modos:
//  - Firebase (modo família): dados online, compartilhados por todos.
//  - Local (modo demonstração): dados só neste navegador.
(function () {
  const cfg = window.FIREBASE_CONFIG || {};
  const useFirebase = !!(cfg.apiKey && cfg.projectId && window.firebase);

  const ERRORS = {
    'auth/email-already-in-use': 'Este usuário já existe. Escolha outro ou use "Entrar".',
    'auth/invalid-email': 'Usuário inválido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 4 caracteres.',
    'auth/invalid-credential': 'Usuário ou senha incorretos.',
    'auth/wrong-password': 'Usuário ou senha incorretos.',
    'auth/user-not-found': 'Usuário ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Espere alguns minutos e tente de novo.',
    'permission-denied': 'Você não tem permissão para fazer isso.',
  };
  // Login por usuário: vira um e-mail interno, e a senha ganha um complemento
  // porque o Firebase exige no mínimo 6 caracteres.
  const ADMIN_USER = 'barbara';
  const DOMAIN = '@consultas-familia.app';
  const toEmail = (u) => String(u || '').trim().toLowerCase() + DOMAIN;
  const toPass = (p) => String(p) + '#cf2026';
  const cleanUser = (u) => String(u || '').trim().toLowerCase();
  const checkNew = (username, password) => {
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw new Error('Usuário: use de 3 a 30 letras minúsculas, números, ponto ou traço (sem espaço e sem acento).');
    if (String(password).length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
  };
  const friendly = (e) => new Error(ERRORS[e?.code] || e?.message || 'Algo deu errado. Tente de novo.');

  // ---------------- Firebase ----------------
  function firebaseStore() {
    firebase.initializeApp(cfg);
    const auth = firebase.auth();
    const fs = firebase.firestore();
    let profile = null;
    let listener = () => {};

    const all = async (q) => (await q.get()).docs.map((d) => ({ ...d.data(), id: d.id }));

    return {
      mode: 'firebase',
      onAuth(cb) {
        listener = cb;
        auth.onAuthStateChanged(async (u) => {
          if (!u) { profile = null; return cb(null); }
          const snap = await fs.doc(`users/${u.uid}`).get();
          if (!snap.exists) {
            if (signingUp) return; // cadastro ainda sendo criado; signUp avisa quando terminar
            await auth.signOut(); // conta removida pelo administrador
            return;
          }
          profile = { ...snap.data(), id: u.uid };
          cb(profile);
        });
      },
      async signUp(data, password) {
        try {
          data.username = cleanUser(data.username);
          checkNew(data.username, password);
          signingUp = true;
          const cred = await auth.createUserWithEmailAndPassword(toEmail(data.username), toPass(password));
          const uid = cred.user.uid;
          const role = data.username === ADMIN_USER ? 'admin' : 'membro';
          await fs.doc(`users/${uid}`).set({ ...data, role, createdAt: new Date().toISOString() });
          profile = { ...data, role, id: uid };
          listener(profile);
        } catch (e) { throw friendly(e); } finally { signingUp = false; }
      },
      async signIn(username, password) {
        try { await auth.signInWithEmailAndPassword(toEmail(username), toPass(password)); } catch (e) { throw friendly(e); }
      },
      async changePassword(password) {
        if (String(password).length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
        try { await auth.currentUser.updatePassword(toPass(password)); } catch (e) {
          if (e?.code === 'auth/requires-recent-login') throw new Error('Por segurança, saia e entre de novo antes de trocar a senha.');
          throw friendly(e);
        }
      },
      signOut: () => auth.signOut(),
      async load() {
        const isAdmin = profile?.role === 'admin';
        const appts = isAdmin ? all(fs.collection('appointments'))
          : all(fs.collection('appointments').where('memberId', '==', profile.id));
        const [users, doctors, appointments] = await Promise.all([all(fs.collection('users')), all(fs.collection('doctors')), appts]);
        return { users, doctors, appointments };
      },
      async save(col, id, data) {
        try {
          if (id) await fs.doc(`${col}/${id}`).set(data, { merge: true });
          else await fs.collection(col).add(data);
        } catch (e) { throw friendly(e); }
      },
      async remove(col, id) { try { await fs.doc(`${col}/${id}`).delete(); } catch (e) { throw friendly(e); } },
    };
  }

  // ---------------- Local (demonstração) ----------------
  function localStore() {
    const KEY = 'consultas-demo-db';
    const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
    const db = Object.assign({ users: {}, doctors: {}, appointments: {}, passwords: {}, session: null }, read());
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
    const id = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    let listener = () => {};
    const hash = async (s) => {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    };
    const current = () => (db.session && db.users[db.session] ? { ...db.users[db.session], id: db.session } : null);
    const list = (col) => Object.entries(db[col]).map(([k, v]) => ({ ...v, id: k }));

    return {
      mode: 'local',
      onAuth(cb) { listener = cb; setTimeout(() => cb(current()), 0); },
      async signUp(data, password) {
        data.username = cleanUser(data.username);
        checkNew(data.username, password);
        if (Object.values(db.users).some((u) => u.username === data.username)) throw new Error(ERRORS['auth/email-already-in-use']);
        const uid = id();
        const role = data.username === ADMIN_USER ? 'admin' : 'membro';
        db.users[uid] = { ...data, role, createdAt: new Date().toISOString() };
        db.passwords[uid] = await hash(password);
        db.session = uid; persist();
        listener(current());
      },
      async signIn(username, password) {
        const uid = Object.keys(db.users).find((k) => db.users[k].username === cleanUser(username));
        if (!uid || db.passwords[uid] !== (await hash(password))) throw new Error(ERRORS['auth/invalid-credential']);
        db.session = uid; persist(); listener(current());
      },
      async changePassword(password) {
        if (String(password).length < 4) throw new Error('A senha precisa ter pelo menos 4 caracteres.');
        db.passwords[db.session] = await hash(password); persist();
      },
      async signOut() { db.session = null; persist(); listener(null); },
      async load() {
        const me = current();
        const appointments = list('appointments').filter((a) => me.role === 'admin' || a.memberId === me.id);
        return { users: list('users'), doctors: list('doctors'), appointments };
      },
      async save(col, docId, data) {
        const k = docId || id();
        db[col][k] = { ...(db[col][k] || {}), ...data };
        persist();
        if (col === 'users' && k === db.session) listener(current());
      },
      async remove(col, docId) { delete db[col][docId]; if (col === 'users') delete db.passwords[docId]; persist(); },
      resetDemo() { localStorage.removeItem(KEY); location.reload(); },
    };
  }

  window.Store = useFirebase ? firebaseStore() : localStore();
})();
