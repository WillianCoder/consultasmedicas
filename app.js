(function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app'), nav = $('#nav'), topbar = $('#topbar'), modal = $('#modal');

  // ---------- Constantes ----------
  const STATUSES = ['agendada', 'confirmada', 'realizada', 'cancelada', 'remarcada'];
  const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
  const OPTIONAL = ['birthDate', 'bloodType', 'allergies', 'insurance', 'insuranceNumber', 'emergencyContact'];
  const WEEK = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const WEEK_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const COLORS = ['#0f766e', '#c2306b', '#1d5fbf', '#d1541b', '#6a4bc4', '#3f6b22', '#a16207', '#0e7490', '#9f1239', '#4d5bd6'];
  const THEMES = [
    ['claro', 'Clínica (claro)'], ['escuro', 'Noite'], ['oceano', 'Oceano'], ['floresta', 'Floresta'], ['lavanda', 'Lavanda'],
    ['por-do-sol', 'Pôr do sol'], ['cafe', 'Café'], ['rosa', 'Rosa'], ['menta', 'Menta'], ['grafite', 'Grafite'],
    ['meia-noite', 'Meia-noite'], ['alto-contraste', 'Alto contraste'], ['papel', 'Papel'],
  ];
  const LIST_VIEWS = [['lista', 'Lista'], ['cartoes', 'Cartões'], ['tabela', 'Tabela'], ['linha', 'Linha do tempo'], ['pessoa', 'Por pessoa'], ['status', 'Por status']];
  const CAL_VIEWS = [['mes', 'Mês'], ['mes-compacto', 'Mês compacto'], ['semana', 'Semana'], ['dia', 'Dia'], ['agenda', 'Agenda do mês'], ['ano', 'Ano']];

  // ---------- Preferências (ficam neste aparelho) ----------
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('consultas-prefs')) || {}; } catch { return {}; } })();
  const setPref = (k, v) => { prefs[k] = v; try { localStorage.setItem('consultas-prefs', JSON.stringify(prefs)); } catch {} };
  function applyPrefs() {
    document.documentElement.dataset.theme = prefs.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro');
    document.body.classList.toggle('big', !!prefs.big);
  }
  applyPrefs();

  // ---------- Estado ----------
  const S = { me: null, users: [], doctors: [], appts: [], ready: false };
  let calDate = new Date();
  let listFilter = { period: 'proximas', member: '', status: '', q: '' };
  let calMember = '';

  // ---------- Utilitários ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const nowKey = () => { const d = new Date(); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hhmm = (v) => (v ? v.slice(11, 16) : '');
  const fmt = (v) => { if (!v) return ''; const d = new Date(v); return `${WEEK[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${hhmm(v)}`; };
  const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const first = (n) => String(n || '').split(' ')[0];
  const isAdmin = () => S.me?.role === 'admin';
  const user = (id) => S.users.find((u) => u.id === id);
  const uname = (id) => user(id)?.name || 'Membro removido';
  const doctor = (id) => S.doctors.find((d) => d.id === id);
  const colorOf = (id) => { const i = [...S.users].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).findIndex((u) => u.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
  const who = (a) => { const d = doctor(a.doctorId); return [d?.name, a.specialty || d?.specialty].filter(Boolean).join(' – ') || 'Consulta'; };
  const sortAsc = (x, y) => (x.dateTime || '').localeCompare(y.dateTime || '');

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }
  async function act(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await reload(); return true; }
    catch (e) { toast(e.message || 'Não foi possível salvar.'); return false; }
  }
  async function reload() {
    if (!S.me) return;
    try { const r = await Store.load(); S.users = r.users; S.doctors = r.doctors; S.appts = r.appointments; S.me = user(S.me.id) || S.me; } catch (e) { toast('Não foi possível carregar os dados.'); }
    S.ready = true; render();
  }

  // ---------- Lembretes ----------
  function pending() {
    const now = new Date(), today = dayKey(now);
    return S.appts
      .filter((a) => !a.reminderSentAt && ['agendada', 'confirmada'].includes(a.status) && new Date(a.dateTime) > now)
      .map((a) => { const due = new Date(a.dateTime); due.setDate(due.getDate() - (a.remindDays ?? 1)); return { ...a, overdue: dayKey(due) < today, dueDay: dayKey(due) }; })
      .filter((a) => a.dueDay <= today).sort(sortAsc);
  }
  function message(a) {
    const d = doctor(a.doctorId);
    const lines = [`🩺 *Olá, ${first(uname(a.memberId))}!*`, `Lembrete de consulta: ${fmt(a.dateTime)}`, `👨‍⚕️ ${who(a)}`];
    const place = a.location || d?.address; if (place) lines.push(`📍 ${place}`);
    if (a.bring) lines.push(`📋 Levar: ${a.bring}`);
    lines.push('', 'Responda *1* para confirmar ou *2* para remarcar.');
    return lines.join('\n');
  }
  const phone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };
  const waLink = (a) => `https://wa.me/${phone(user(a.memberId)?.whatsapp)}?text=${encodeURIComponent(message(a))}`;

  // ---------- Rotas ----------
  const VIEWS = { inicio: 'Início', calendario: 'Calendário', consultas: 'Consultas', medicos: 'Médicos', lembretes: 'Lembretes', familia: 'Família', aparencia: 'Aparência', perfil: 'Meu perfil' };
  const ADMIN_ONLY = ['lembretes', 'familia'];
  const route = () => { const h = location.hash.slice(1); return VIEWS[h] && (isAdmin() || !ADMIN_ONLY.includes(h)) ? h : 'inicio'; };

  function render() {
    if (!S.me) { topbar.hidden = true; return renderAuth(); }
    if (!S.ready) return;
    const view = route(), pend = isAdmin() ? pending().length : 0;
    topbar.hidden = false;
    nav.innerHTML = Object.entries(VIEWS).filter(([k]) => isAdmin() || !ADMIN_ONLY.includes(k))
      .map(([k, v]) => `<a href="#${k}" ${k === view ? 'aria-current="page"' : ''}>${v}${k === 'lembretes' && pend ? `<span class="count">${pend}</span>` : ''}</a>`).join('')
      + '<button data-logout>Sair</button>';
    const alert = isAdmin() && pend && view !== 'lembretes' ? `<a class="alert" href="#lembretes">🔔 Você tem ${pend} lembrete${pend > 1 ? 's' : ''} para enviar no WhatsApp →</a>` : '';
    app.innerHTML = alert + ({ inicio: vHome, calendario: vCalendar, consultas: vAppts, medicos: vDoctors, lembretes: vReminders, familia: vFamily, aparencia: vLook, perfil: vProfile }[view])();
  }

  // ---------- Login e cadastro ----------
  let authMode = 'entrar';
  function renderAuth() {
    const isNew = authMode === 'cadastro';
    app.innerHTML = `<div class="card narrow">
      <h1>🩺 Consultas da Família</h1>
      <div class="tabs" role="group" aria-label="Entrar ou cadastrar">
        <button data-auth="entrar" aria-pressed="${!isNew}">Entrar</button>
        <button data-auth="cadastro" aria-pressed="${isNew}">Criar minha conta</button>
      </div>
      <div id="auth-error" class="error" hidden></div>
      ${isNew ? `<form id="signup">
        <label>Seu nome *<input id="s-name" name="name" required autocomplete="name"></label>
        <label>Usuário * <span class="muted">para entrar no site. Ex.: maria, joao.silva</span><input id="s-username" name="username" required autocapitalize="none" autocomplete="username"></label>
        <label>Senha * <span class="muted">mínimo 4 caracteres</span><input id="s-password" name="password" type="password" required minlength="4" autocomplete="new-password"></label>
        <label>WhatsApp * <span class="muted">com DDD, para receber os lembretes</span><input id="s-whatsapp" name="whatsapp" required inputmode="tel" placeholder="(11) 99999-9999"></label>
        ${healthFields({})}
        <button>Criar conta</button>
      </form>` : `<form id="login">
        <label>Usuário<input id="l-username" name="username" required autocapitalize="none" autocomplete="username"></label>
        <label>Senha<input id="l-password" name="password" type="password" required autocomplete="current-password"></label>
        <button>Entrar</button>
        <p class="muted">Esqueceu a senha? Fale com o administrador da família.</p>
      </form>`}
    </div>`;
  }

  function healthFields(f) {
    const open = OPTIONAL.some((k) => f[k]);
    return `<details class="optional" ${open ? 'open' : ''}><summary>Dados de saúde <span class="muted">(opcional, pode preencher depois)</span></summary>
      <div style="display:grid;gap:12px">
      <div class="grid2">
        <label>Data de nascimento<input id="h-birthDate" name="birthDate" type="date" value="${esc(f.birthDate)}"></label>
        <label>Tipo sanguíneo<select id="h-bloodType" name="bloodType"><option value="">Não informado</option>${BLOOD.map((b) => `<option ${f.bloodType === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
        <label>Convênio<input id="h-insurance" name="insurance" value="${esc(f.insurance)}" placeholder="Ex.: Unimed"></label>
        <label>Nº da carteirinha<input id="h-insuranceNumber" name="insuranceNumber" value="${esc(f.insuranceNumber)}"></label>
      </div>
      <label>Alergias<textarea id="h-allergies" name="allergies" rows="2" placeholder="Ex.: dipirona, amendoim">${esc(f.allergies)}</textarea></label>
      <label>Contato de emergência<input id="h-emergencyContact" name="emergencyContact" value="${esc(f.emergencyContact)}" placeholder="Nome e telefone"></label>
      </div></details>`;
  }
  const profileFrom = (f) => { const o = { name: clean(f.name), whatsapp: clean(f.whatsapp) }; OPTIONAL.forEach((k) => (o[k] = clean(f[k]))); return o; };

  // ---------- Início ----------
  function vHome() {
    const now = nowKey();
    const next = S.appts.filter((a) => a.dateTime >= now && !['cancelada', 'realizada'].includes(a.status)).sort(sortAsc);
    const today = next.filter((a) => a.dateTime.slice(0, 10) === now.slice(0, 10));
    return `<div class="card"><div class="row"><h1>Olá, ${esc(first(S.me.name))}!</h1><button data-new>+ Nova consulta</button></div>
      <p class="muted">${today.length ? `Hoje tem ${today.length} consulta${today.length > 1 ? 's' : ''}.` : 'Nenhuma consulta hoje.'} ${isAdmin() ? 'Você é administrador e vê a agenda de toda a família.' : ''}</p>
      <h2>Próximas consultas</h2>
      ${next.length ? viewList(next.slice(0, 8)) : '<p class="empty">Nenhuma consulta marcada. Toque em “Nova consulta” para cadastrar.</p>'}
      <div><a class="btn secondary" href="#calendario">📅 Ver calendário</a></div></div>`;
  }

  // ---------- Consultas (várias visualizações) ----------
  function itemLine(a) {
    return `<div><span class="dot" style="background:${colorOf(a.memberId)}"></span><span class="when">${esc(fmt(a.dateTime))}</span> <span class="pill ${esc(a.status)}">${esc(a.status)}</span>
      <div>${esc(uname(a.memberId))} · ${esc(who(a))}</div>
      ${a.location || doctor(a.doctorId)?.address ? `<div class="muted">📍 ${esc(a.location || doctor(a.doctorId).address)}</div>` : ''}</div>`;
  }
  const viewList = (list) => `<ul class="list">${list.map((a) => `<li class="clickable" data-open="${esc(a.id)}">${itemLine(a)}<span class="muted">Abrir ›</span></li>`).join('')}</ul>`;
  const viewCards = (list) => `<div class="cards">${list.map((a) => { const d = new Date(a.dateTime); return `<button class="acard" style="--c:${colorOf(a.memberId)}" data-open="${esc(a.id)}">
      <span class="muted">${WEEK[d.getDay()]}</span><span class="big">${pad(d.getDate())}/${pad(d.getMonth() + 1)} · ${hhmm(a.dateTime)}</span>
      <strong>${esc(uname(a.memberId))}</strong><span>${esc(who(a))}</span><span><span class="pill ${esc(a.status)}">${esc(a.status)}</span></span></button>`; }).join('')}</div>`;
  const viewTable = (list) => `<div class="table-wrap"><table><thead><tr><th>Data</th><th>Hora</th><th>Paciente</th><th>Médico / especialidade</th><th>Local</th><th>Status</th></tr></thead><tbody>
      ${list.map((a) => `<tr data-open="${esc(a.id)}"><td class="when">${a.dateTime.slice(8, 10)}/${a.dateTime.slice(5, 7)}/${a.dateTime.slice(0, 4)}</td><td>${hhmm(a.dateTime)}</td>
      <td><span class="dot" style="background:${colorOf(a.memberId)}"></span>${esc(uname(a.memberId))}</td><td>${esc(who(a))}</td><td>${esc(a.location || doctor(a.doctorId)?.address || '')}</td><td><span class="pill ${esc(a.status)}">${esc(a.status)}</span></td></tr>`).join('')}</tbody></table></div>`;
  function viewTimeline(list) {
    let last = '', out = '';
    list.forEach((a) => { const m = a.dateTime.slice(0, 7); if (m !== last) { last = m; out += `<div class="tl-month">${MONTHS[+m.slice(5) - 1]} de ${m.slice(0, 4)}</div>`; }
      out += `<div class="tl-item" style="--c:${colorOf(a.memberId)}" data-open="${esc(a.id)}"><span class="when">${esc(fmt(a.dateTime))}</span><div>${esc(uname(a.memberId))} · ${esc(who(a))} <span class="pill ${esc(a.status)}">${esc(a.status)}</span></div></div>`; });
    return `<div class="timeline">${out}</div>`;
  }
  const mini = (a, label) => `<button class="mini" style="--c:${colorOf(a.memberId)}" data-open="${esc(a.id)}"><strong class="when">${a.dateTime.slice(8, 10)}/${a.dateTime.slice(5, 7)} ${hhmm(a.dateTime)}</strong><br>${esc(label)}</button>`;
  function viewByPerson(list) {
    const ids = [...new Set(list.map((a) => a.memberId))];
    return `<div class="columns">${ids.map((id) => `<div class="column"><h3><span class="dot" style="background:${colorOf(id)}"></span>${esc(uname(id))}</h3>
      ${list.filter((a) => a.memberId === id).map((a) => mini(a, who(a))).join('')}</div>`).join('')}</div>`;
  }
  const viewByStatus = (list) => `<div class="columns">${STATUSES.map((s) => `<div class="column"><h3><span class="pill ${s}">${s}</span></h3>
      ${list.filter((a) => a.status === s).map((a) => mini(a, `${uname(a.memberId)} · ${who(a)}`)).join('') || '<span class="muted">Nenhuma</span>'}</div>`).join('')}</div>`;

  function vAppts() {
    const view = prefs.listView || 'lista', now = nowKey(), f = listFilter;
    let list = S.appts.filter((a) => f.period === 'todas' || (f.period === 'proximas' ? a.dateTime >= now : a.dateTime < now));
    if (f.member) list = list.filter((a) => a.memberId === f.member);
    if (f.status) list = list.filter((a) => a.status === f.status);
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((a) => `${uname(a.memberId)} ${who(a)} ${a.location || ''} ${a.reason || ''}`.toLowerCase().includes(q)); }
    list.sort(sortAsc); if (f.period === 'passadas') list.reverse();
    const body = !list.length ? '<p class="empty">Nenhuma consulta com esses filtros.</p>'
      : { lista: viewList, cartoes: viewCards, tabela: viewTable, linha: viewTimeline, pessoa: viewByPerson, status: viewByStatus }[view](list);
    return `<div class="card"><div class="row"><h1>Consultas</h1><button data-new>+ Nova consulta</button></div>
      <div class="tabs" role="group" aria-label="Forma de ver">${LIST_VIEWS.map(([k, v]) => `<button data-listview="${k}" aria-pressed="${view === k}">${v}</button>`).join('')}</div>
      <div class="filters">
        <select id="f-period" aria-label="Período">${[['proximas', 'Próximas'], ['passadas', 'Passadas'], ['todas', 'Todas']].map(([k, v]) => `<option value="${k}" ${f.period === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${isAdmin() ? `<select id="f-member" aria-label="Pessoa"><option value="">Toda a família</option>${S.users.map((u) => `<option value="${esc(u.id)}" ${f.member === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
        <select id="f-status" aria-label="Status"><option value="">Todos os status</option>${STATUSES.map((s) => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <input id="f-q" type="search" placeholder="Buscar médico, local…" value="${esc(f.q)}">
      </div>
      <p class="muted">${list.length} consulta${list.length === 1 ? '' : 's'}</p>
      ${body}</div>`;
  }

  // ---------- Calendário (várias visualizações) ----------
  const calAppts = () => S.appts.filter((a) => !calMember || a.memberId === calMember);
  const byDay = () => { const m = {}; calAppts().forEach((a) => (m[a.dateTime.slice(0, 10)] ||= []).push(a)); Object.values(m).forEach((l) => l.sort(sortAsc)); return m; };
  const evChip = (a) => `<button class="ev ${esc(a.status)}" style="--c:${colorOf(a.memberId)}" data-open="${esc(a.id)}" title="${esc(`${hhmm(a.dateTime)} ${uname(a.memberId)} · ${who(a)}`)}">${hhmm(a.dateTime)} ${esc(first(uname(a.memberId)))}</button>`;

  function monthGrid(year, month, compact) {
    const map = byDay(), today = dayKey(new Date());
    const start = new Date(year, month, 1); start.setDate(1 - start.getDay());
    let cells = WEEK_SHORT.map((w) => `<div class="wd">${w}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      if (i === 35 && d.getMonth() !== month) break;
      const k = dayKey(d), evs = map[k] || [];
      const shown = compact ? evs : evs.slice(0, 3);
      cells += `<div class="day ${d.getMonth() !== month ? 'other' : ''} ${k === today ? 'today' : ''}" data-day="${k}">
        <span class="num">${d.getDate()}</span><div class="evs">${shown.map(evChip).join('')}</div>
        ${!compact && evs.length > 3 ? `<span class="more">+${evs.length - 3} mais</span>` : ''}</div>`;
    }
    return `<div class="month ${compact ? 'compact' : ''}">${cells}</div>`;
  }
  function weekView() {
    const map = byDay(), today = dayKey(new Date());
    const s = new Date(calDate); s.setDate(s.getDate() - s.getDay());
    let out = '';
    for (let i = 0; i < 7; i++) { const d = new Date(s); d.setDate(s.getDate() + i); const k = dayKey(d);
      out += `<div class="wcol ${k === today ? 'today' : ''}" data-day="${k}"><h3>${WEEK_SHORT[d.getDay()]} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}</h3>
        ${(map[k] || []).map((a) => mini(a, `${first(uname(a.memberId))} · ${who(a)}`)).join('') || '<span class="muted">Livre</span>'}</div>`; }
    return `<div class="week">${out}</div>`;
  }
  function dayView() {
    const k = dayKey(calDate), list = byDay()[k] || [];
    return `${list.length ? viewList(list) : '<p class="empty">Nenhuma consulta neste dia.</p>'}<div><button class="secondary" data-new-day="${k}">+ Consulta neste dia</button></div>`;
  }
  function agendaView() {
    const ym = `${calDate.getFullYear()}-${pad(calDate.getMonth() + 1)}`, map = byDay();
    const days = Object.keys(map).filter((k) => k.startsWith(ym)).sort();
    if (!days.length) return '<p class="empty">Nenhuma consulta neste mês.</p>';
    return days.map((k) => { const d = new Date(k + 'T12:00'); return `<h3 style="text-transform:capitalize">${WEEK[d.getDay()]}, ${d.getDate()} de ${MONTHS[d.getMonth()]}</h3>${viewList(map[k])}`; }).join('');
  }
  function yearView() {
    const y = calDate.getFullYear(), map = byDay();
    return `<div class="year">${MONTHS.map((m, mi) => {
      const start = new Date(y, mi, 1), offset = start.getDay(), days = new Date(y, mi + 1, 0).getDate();
      let g = WEEK_SHORT.map((w) => `<span class="wdh">${w[0]}</span>`).join('') + '<span></span>'.repeat(offset);
      for (let d = 1; d <= days; d++) { const k = `${y}-${pad(mi + 1)}-${pad(d)}`; g += map[k] ? `<span class="has" data-goday="${k}" title="${map[k].length} consulta(s)">${d}</span>` : `<span>${d}</span>`; }
      return `<div class="ymonth"><h3 data-gomonth="${mi}">${m}</h3><div class="ygrid">${g}</div></div>`; }).join('')}</div>`;
  }
  function calTitle(view) {
    if (view === 'ano') return String(calDate.getFullYear());
    if (view === 'dia') { const w = WEEK[calDate.getDay()]; return `${w[0].toUpperCase() + w.slice(1)}, ${calDate.getDate()} de ${MONTHS[calDate.getMonth()]}`; }
    if (view === 'semana') { const s = new Date(calDate); s.setDate(s.getDate() - s.getDay()); const e = new Date(s); e.setDate(s.getDate() + 6); return `${pad(s.getDate())}/${pad(s.getMonth() + 1)} a ${pad(e.getDate())}/${pad(e.getMonth() + 1)}`; }
    const m = MONTHS[calDate.getMonth()]; return `${m[0].toUpperCase() + m.slice(1)} de ${calDate.getFullYear()}`;
  }
  function vCalendar() {
    const view = prefs.calView || 'mes';
    const body = { mes: () => monthGrid(calDate.getFullYear(), calDate.getMonth(), false), 'mes-compacto': () => monthGrid(calDate.getFullYear(), calDate.getMonth(), true), semana: weekView, dia: dayView, agenda: agendaView, ano: yearView }[view]();
    const people = [...new Set(S.appts.map((a) => a.memberId))];
    return `<div class="card">
      <div class="cal-head"><h1>${esc(calTitle(view))}</h1>
        <div class="cal-nav"><button class="secondary" data-cal="-1" aria-label="Anterior">‹</button><button class="secondary" data-cal="0">Hoje</button><button class="secondary" data-cal="1" aria-label="Próximo">›</button><button data-new>+ Nova</button></div></div>
      <div class="tabs" role="group" aria-label="Forma de ver o calendário">${CAL_VIEWS.map(([k, v]) => `<button data-calview="${k}" aria-pressed="${view === k}">${v}</button>`).join('')}</div>
      ${isAdmin() ? `<div class="filters"><select id="cal-member" aria-label="Pessoa"><option value="">Toda a família</option>${S.users.map((u) => `<option value="${esc(u.id)}" ${calMember === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>` : ''}
      ${body}
      ${people.length ? `<div class="legend">${people.map((id) => `<span><span class="dot" style="background:${colorOf(id)}"></span>${esc(uname(id))}</span>`).join('')}</div>` : ''}
      <p class="muted">Toque em um dia para marcar uma consulta, ou em uma consulta para ver e editar.</p></div>`;
  }
  function moveCal(step) {
    const view = prefs.calView || 'mes';
    if (step === 0) { calDate = new Date(); return; }
    if (view === 'ano') calDate = new Date(calDate.getFullYear() + step, calDate.getMonth(), 1);
    else if (view === 'semana') calDate.setDate(calDate.getDate() + 7 * step);
    else if (view === 'dia') calDate.setDate(calDate.getDate() + step);
    else calDate = new Date(calDate.getFullYear(), calDate.getMonth() + step, 1);
  }

  // ---------- Janela de consulta ----------
  function openAppt(id, day) {
    const a = id ? S.appts.find((x) => x.id === id) : { memberId: S.me.id, status: 'agendada', remindDays: 1, dateTime: day ? `${day}T09:00` : '' };
    if (!a) return;
    const canEdit = isAdmin() || a.memberId === S.me.id;
    const dis = canEdit ? '' : 'disabled';
    modal.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="Consulta">
      <div class="row"><h2>${id ? 'Consulta' : 'Nova consulta'}</h2><button class="ghost" data-close aria-label="Fechar">✕</button></div>
      <form id="appt" data-id="${esc(id || '')}">
        ${isAdmin() ? `<label>Paciente *<select id="a-memberId" name="memberId">${S.users.map((u) => `<option value="${esc(u.id)}" ${a.memberId === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>` : `<p class="muted">Paciente: <strong>${esc(uname(a.memberId))}</strong></p>`}
        <label>Data e hora *<input id="a-dateTime" name="dateTime" type="datetime-local" required value="${esc(a.dateTime)}" ${dis}></label>
        <label>Médico<select id="a-doctorId" name="doctorId" ${dis}><option value="">Não informado</option>${[...S.doctors].sort((x, y) => x.name.localeCompare(y.name)).map((d) => `<option value="${esc(d.id)}" ${a.doctorId === d.id ? 'selected' : ''}>${esc(d.name)}${d.specialty ? ' (' + esc(d.specialty) + ')' : ''}</option>`).join('')}</select>
          <span class="muted">Não está na lista? Cadastre na aba <a href="#medicos">Médicos</a>.</span></label>
        <label>Especialidade<input id="a-specialty" name="specialty" value="${esc(a.specialty)}" placeholder="Ex.: Pediatria" ${dis}></label>
        <label>Local<input id="a-location" name="location" value="${esc(a.location)}" placeholder="Endereço da clínica" ${dis}></label>
        <label>Motivo / anotações<textarea id="a-reason" name="reason" rows="2" ${dis}>${esc(a.reason)}</textarea></label>
        <label>O que levar<input id="a-bring" name="bring" value="${esc(a.bring)}" placeholder="Ex.: carteirinha, exames anteriores" ${dis}></label>
        <div class="grid2">
          <label>Status<select id="a-status" name="status" ${dis}>${STATUSES.map((s) => `<option ${a.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>Lembrete: quantos dias antes<input id="a-remindDays" name="remindDays" type="number" min="0" max="30" value="${esc(a.remindDays ?? 1)}" ${dis}></label>
        </div>
        ${canEdit ? `<div class="actions"><button>Salvar</button><button type="button" class="secondary" data-close>Cancelar</button>
          ${id ? `<button type="button" class="danger" data-del-appt="${esc(id)}">Excluir</button>` : ''}</div>` : ''}
      </form></div>`;
    modal.hidden = false;
    $('#a-dateTime', modal)?.focus();
  }
  const closeModal = () => { modal.hidden = true; modal.innerHTML = ''; };

  // ---------- Médicos ----------
  function vDoctors() {
    const list = [...S.doctors].sort((x, y) => x.name.localeCompare(y.name));
    return `<div class="card"><h1>Médicos e clínicas</h1>
      ${list.length ? `<ul class="list">${list.map((d) => `<li><div><strong>${esc(d.name)}</strong> ${d.specialty ? `<span class="pill">${esc(d.specialty)}</span>` : ''}
        <div class="muted">${esc([d.crm && 'CRM ' + d.crm, d.phone, d.address].filter(Boolean).join(' · '))}</div></div>
        ${isAdmin() ? `<div class="actions"><button class="small secondary" data-edit-doc="${esc(d.id)}">Editar</button><button class="small danger" data-del-doc="${esc(d.id)}">Excluir</button></div>` : ''}</li>`).join('')}</ul>`
        : '<p class="empty">Nenhum médico cadastrado ainda.</p>'}</div>
      <div class="card narrow"><h2>Cadastrar médico</h2>${doctorForm({})}</div>`;
  }
  const doctorForm = (d) => `<form id="doctor" data-id="${esc(d.id || '')}">
      <label>Nome *<input id="d-name" name="name" required value="${esc(d.name)}" placeholder="Ex.: Dr. João Lima"></label>
      <div class="grid2"><label>Especialidade<input id="d-specialty" name="specialty" value="${esc(d.specialty)}"></label><label>CRM<input id="d-crm" name="crm" value="${esc(d.crm)}"></label></div>
      <label>Telefone<input id="d-phone" name="phone" value="${esc(d.phone)}"></label>
      <label>Endereço<input id="d-address" name="address" value="${esc(d.address)}"></label>
      <div class="actions"><button>${d.id ? 'Salvar' : 'Cadastrar'}</button>${d.id ? '<button type="button" class="secondary" data-close>Cancelar</button>' : ''}</div></form>`;

  // ---------- Lembretes ----------
  function vReminders() {
    const pend = pending();
    const sent = S.appts.filter((a) => a.reminderSentAt).sort((x, y) => y.reminderSentAt.localeCompare(x.reminderSentAt)).slice(0, 30);
    return `<div class="card"><h1>Lembretes para enviar</h1>
      <p class="muted">Toque em <strong>Enviar no WhatsApp</strong>: a conversa abre com a mensagem pronta. Depois de enviar, toque em <strong>Marcar enviado</strong>.</p>
      ${pend.length ? `<ul class="list">${pend.map((a) => `<li class="${a.overdue ? 'overdue' : ''}"><div>
        <span class="pill ${a.overdue ? 'atrasado' : ''}">${a.overdue ? 'atrasado' : 'enviar hoje'}</span> <strong>${esc(uname(a.memberId))}</strong> · ${esc(who(a))}
        <div class="muted"><span class="when">${esc(fmt(a.dateTime))}</span> · WhatsApp: ${esc(user(a.memberId)?.whatsapp)}</div>
        <details><summary class="muted">Ver mensagem</summary><div class="ficha">${esc(message(a))}</div></details></div>
        <div class="actions"><a class="btn wa" href="${esc(waLink(a))}" target="_blank" rel="noopener">Enviar no WhatsApp</a><button class="secondary" data-sent="${esc(a.id)}">Marcar enviado</button></div></li>`).join('')}</ul>`
        : '<p class="empty">✅ Nenhum lembrete pendente. Tudo em dia.</p>'}</div>
      <div class="card"><h2>Histórico de enviados</h2>
      ${sent.length ? `<ul class="list">${sent.map((a) => `<li><div><strong>${esc(uname(a.memberId))}</strong> · consulta <span class="when">${esc(fmt(a.dateTime))}</span>
        <div class="muted">Enviado em ${esc(new Date(a.reminderSentAt).toLocaleString('pt-BR'))}</div></div><button class="small secondary" data-unsent="${esc(a.id)}">Desfazer</button></li>`).join('')}</ul>`
        : '<p class="empty">Nenhum lembrete enviado ainda.</p>'}</div>`;
  }

  // ---------- Família (admin) ----------
  function vFamily() {
    const list = [...S.users].sort((x, y) => x.name.localeCompare(y.name));
    return `<div class="card"><h1>Família</h1>
      <p class="muted">Para adicionar alguém, envie o link do site: a pessoa toca em <strong>Criar minha conta</strong>. Aqui você pode editar os dados de qualquer pessoa e escolher quem é administrador.</p>
      <ul class="list">${list.map((u) => `<li><div><span class="dot" style="background:${colorOf(u.id)}"></span><strong>${esc(u.name)}</strong> <span class="pill">${u.role === 'admin' ? 'administrador' : 'membro'}</span> ${u.id === S.me.id ? '<span class="pill">você</span>' : ''}
        <div class="muted">${esc(['usuário: ' + (u.username || '—'), 'WhatsApp: ' + u.whatsapp, u.bloodType && 'Tipo ' + u.bloodType, u.allergies && 'Alergias: ' + u.allergies, u.insurance && 'Convênio: ' + u.insurance].filter(Boolean).join(' · '))}</div></div>
        <div class="actions"><button class="small secondary" data-edit-user="${esc(u.id)}">Editar</button></div></li>`).join('')}</ul></div>`;
  }
  function openUser(id) {
    const u = user(id); if (!u) return;
    const admins = S.users.filter((x) => x.role === 'admin').length;
    const lastAdmin = u.role === 'admin' && admins <= 1;
    modal.innerHTML = `<div class="card" role="dialog" aria-modal="true" aria-label="Editar pessoa">
      <div class="row"><h2>Editar ${esc(first(u.name))}</h2><button class="ghost" data-close aria-label="Fechar">✕</button></div>
      <form id="user" data-id="${esc(u.id)}">
        <label>Nome *<input id="u-name" name="name" required value="${esc(u.name)}"></label>
        <label>WhatsApp *<input id="u-whatsapp" name="whatsapp" required value="${esc(u.whatsapp)}"></label>
        <label>Poder no site<select id="u-role" name="role" ${lastAdmin ? 'disabled' : ''}>
          <option value="membro" ${u.role !== 'admin' ? 'selected' : ''}>Membro: vê e cadastra só as próprias consultas</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrador: vê e edita tudo, envia lembretes</option></select>
          ${lastAdmin ? '<span class="muted">É o único administrador, então continua administrador.</span>' : ''}</label>
        ${healthFields(u)}
        <div class="actions"><button>Salvar</button><button type="button" class="secondary" data-close>Cancelar</button>
          ${u.id !== S.me.id ? `<button type="button" class="danger" data-del-user="${esc(u.id)}">Remover da família</button>` : ''}</div>
      </form></div>`;
    modal.hidden = false;
  }

  // ---------- Aparência ----------
  function vLook() {
    const cur = document.documentElement.dataset.theme;
    return `<div class="card"><h1>Aparência</h1><p class="muted">Escolha um tema. Fica salvo só neste aparelho, então cada pessoa escolhe o seu.</p>
      <div class="themes">${THEMES.map(([k, v]) => `<button class="theme-opt" data-theme-pick="${k}" aria-pressed="${cur === k}" data-theme="${k}" style="background:var(--surface);color:var(--fg)">
        ${esc(v)}<span class="swatch"><span style="background:var(--bg)"></span><span style="background:var(--accent)"></span><span style="background:var(--accent-soft)"></span><span style="background:var(--fg)"></span></span></button>`).join('')}</div>
      <label style="display:flex;gap:10px;align-items:center"><input type="checkbox" id="big-font" ${prefs.big ? 'checked' : ''}> Letras maiores</label></div>`;
  }

  // ---------- Perfil ----------
  function vProfile() {
    const m = S.me;
    return `<div class="card narrow"><div class="row"><h1>Meu perfil</h1><span class="pill">${isAdmin() ? 'administrador' : 'membro'}</span></div>
      <p class="muted">Usuário para entrar: <strong>${esc(m.username || '')}</strong></p>
      <form id="profile">
        <label>Nome *<input id="p-name" name="name" required value="${esc(m.name)}"></label>
        <label>WhatsApp *<input id="p-whatsapp" name="whatsapp" required value="${esc(m.whatsapp)}"></label>
        ${healthFields(m)}<div><button>Salvar</button></div></form></div>
      <div class="card narrow"><h2>Trocar senha</h2>
        <form id="password"><label>Nova senha<input id="p-password" name="password" type="password" minlength="4" required autocomplete="new-password"></label><div><button class="secondary">Trocar senha</button></div></form></div>`;
  }

  // ---------- Eventos ----------
  const formObj = (f) => Object.fromEntries(new FormData(f).entries());
  let confirmKey = null;
  const confirmed = (btn, key, label = 'Toque de novo para confirmar') => {
    if (confirmKey === key) { confirmKey = null; return true; }
    confirmKey = key; btn.textContent = label; setTimeout(() => { if (confirmKey === key) confirmKey = null; }, 4000); return false;
  };

  document.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target, f = formObj(form), btn = form.querySelector('button:not([type])');
    if (btn) btn.disabled = true;
    try {
      if (form.id === 'login' || form.id === 'signup') {
        const err = $('#auth-error'); err.hidden = true;
        try {
          if (form.id === 'login') await Store.signIn(f.username, f.password);
          else {
            const data = profileFrom(f);
            if (!data.name || !data.whatsapp) throw new Error('Preencha nome e WhatsApp.');
            await Store.signUp({ ...data, username: f.username }, f.password);
          }
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      } else if (form.id === 'profile') {
        const data = profileFrom(f);
        if (!data.name || !data.whatsapp) return toast('Nome e WhatsApp são obrigatórios.');
        await act(() => Store.save('users', S.me.id, data), 'Perfil atualizado.');
      } else if (form.id === 'password') {
        await act(() => Store.changePassword(f.password), 'Senha trocada.'); form.reset();
      } else if (form.id === 'user') {
        const data = profileFrom(f);
        if (!data.name || !data.whatsapp) return toast('Nome e WhatsApp são obrigatórios.');
        if (f.role) data.role = f.role === 'admin' ? 'admin' : 'membro';
        if (await act(() => Store.save('users', form.dataset.id, data), 'Dados salvos.')) closeModal();
      } else if (form.id === 'doctor') {
        const data = { name: clean(f.name), specialty: clean(f.specialty), crm: clean(f.crm), phone: clean(f.phone), address: clean(f.address) };
        if (!data.name) return toast('Informe o nome do médico.');
        if (!form.dataset.id) data.createdBy = S.me.id;
        if (await act(() => Store.save('doctors', form.dataset.id || null, data), form.dataset.id ? 'Médico atualizado.' : 'Médico cadastrado.')) closeModal();
      } else if (form.id === 'appt') {
        const id = form.dataset.id || null, old = id ? S.appts.find((a) => a.id === id) : null;
        const data = {
          memberId: isAdmin() ? f.memberId : (old?.memberId || S.me.id), dateTime: clean(f.dateTime), doctorId: f.doctorId || null,
          specialty: clean(f.specialty), location: clean(f.location), reason: clean(f.reason), bring: clean(f.bring),
          status: STATUSES.includes(f.status) ? f.status : 'agendada', remindDays: Math.max(0, Math.min(30, Number(f.remindDays) || 0)),
        };
        if (!data.dateTime) return toast('Informe a data e a hora.');
        // Se mudou a data ou o prazo, o lembrete volta a ficar pendente
        data.reminderSentAt = old && old.dateTime === data.dateTime && old.remindDays === data.remindDays && old.memberId === data.memberId ? old.reminderSentAt || null : null;
        if (!old) { data.createdBy = S.me.id; data.createdAt = new Date().toISOString(); }
        if (await act(() => Store.save('appointments', id, data), id ? 'Consulta atualizada.' : 'Consulta cadastrada.')) closeModal();
      }
    } finally { if (btn) btn.disabled = false; }
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('button, [data-open], [data-day], [data-goday], [data-gomonth], nav a');
    if (!el) { if (e.target === modal) closeModal(); return; }
    if (el.matches('nav a')) { nav.classList.remove('open'); return; }
    const d = el.dataset;
    if (el.id === 'menu-btn') { nav.classList.toggle('open'); el.setAttribute('aria-expanded', nav.classList.contains('open')); return; }
    if (d.auth) { authMode = d.auth; return renderAuth(); }
    if ('logout' in d) { await Store.signOut(); return; }
    if ('close' in d) return closeModal();
    if ('new' in d) return openAppt(null, (prefs.calView === 'dia' && route() === 'calendario') ? dayKey(calDate) : null);
    if (d.newDay) return openAppt(null, d.newDay);
    if (d.open) { e.stopPropagation(); return openAppt(d.open); }
    if (d.day) return openAppt(null, d.day);
    if (d.goday) { calDate = new Date(d.goday + 'T12:00'); setPref('calView', 'dia'); return render(); }
    if (d.gomonth) { calDate = new Date(calDate.getFullYear(), +d.gomonth, 1); setPref('calView', 'mes'); return render(); }
    if (d.listview) { setPref('listView', d.listview); return render(); }
    if (d.calview) { setPref('calView', d.calview); return render(); }
    if (d.cal) { moveCal(+d.cal); return render(); }
    if (d.themePick) { setPref('theme', d.themePick); applyPrefs(); return render(); }
    if (d.sent) return act(() => Store.save('appointments', d.sent, { reminderSentAt: new Date().toISOString() }), 'Lembrete marcado como enviado.');
    if (d.unsent) return act(() => Store.save('appointments', d.unsent, { reminderSentAt: null }), 'Lembrete voltou para pendentes.');
    if (d.editUser) return openUser(d.editUser);
    if (d.editDoc) { const doc = doctor(d.editDoc); modal.innerHTML = `<div class="card" role="dialog" aria-modal="true"><div class="row"><h2>Editar médico</h2><button class="ghost" data-close aria-label="Fechar">✕</button></div>${doctorForm(doc)}</div>`; modal.hidden = false; return; }
    if (d.delAppt && confirmed(el, 'a' + d.delAppt)) { if (await act(() => Store.remove('appointments', d.delAppt), 'Consulta excluída.')) closeModal(); return; }
    if (d.delDoc && confirmed(el, 'd' + d.delDoc, 'Confirmar')) return act(() => Store.remove('doctors', d.delDoc), 'Médico excluído.');
    if (d.delUser && confirmed(el, 'u' + d.delUser, 'Toque de novo: apaga a pessoa e as consultas dela')) {
      const ok = await act(async () => { for (const a of S.appts.filter((x) => x.memberId === d.delUser)) await Store.remove('appointments', a.id); await Store.remove('users', d.delUser); }, 'Pessoa removida.');
      if (ok) closeModal();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'f-period') listFilter.period = t.value;
    else if (t.id === 'f-member') listFilter.member = t.value;
    else if (t.id === 'f-status') listFilter.status = t.value;
    else if (t.id === 'cal-member') calMember = t.value;
    else if (t.id === 'big-font') { setPref('big', t.checked); applyPrefs(); return; }
    else return;
    render();
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'f-q') return;
    listFilter.q = e.target.value;
    clearTimeout(document.q); document.q = setTimeout(() => { render(); const i = $('#f-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
  window.addEventListener('hashchange', () => { closeModal(); render(); scrollTo(0, 0); });

  // ---------- Início ----------
  if (Store.mode === 'local') {
    const b = $('#demo-banner');
    b.innerHTML = 'Modo demonstração: os dados ficam salvos só neste aparelho. <button class="small secondary" id="reset-demo">Apagar dados de teste</button>';
    b.hidden = false;
    $('#reset-demo').onclick = () => Store.resetDemo();
  }
  Store.onAuth(async (profile) => {
    S.me = profile; S.ready = false;
    if (!profile) { closeModal(); return render(); }
    app.innerHTML = '<p class="loading">Carregando…</p>';
    await reload();
  });
})();
