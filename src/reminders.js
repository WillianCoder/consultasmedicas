const db = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// "2026-11-05T14:00" -> "quinta, 05/11 às 14:00"
function formatDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return `${WEEKDAYS[d.getDay()]}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Lembretes que o admin precisa enviar: consultas futuras, ativas, ainda não avisadas
// e cujo dia de aviso (data da consulta - N dias) já chegou.
function pendingReminders(now = new Date()) {
  const rows = db.prepare(`
    SELECT a.*, u.name AS patient, u.whatsapp, d.name AS doctor, d.address AS doctor_address
    FROM appointments a JOIN users u ON u.id = a.user_id LEFT JOIN doctors d ON d.id = a.doctor_id
    WHERE a.reminder_sent_at IS NULL AND a.status IN ('agendada', 'confirmada')
    ORDER BY a.date_time`).all();
  const today = dayKey(now);
  return rows
    .filter((r) => new Date(r.date_time) > now)
    .map((r) => {
      const due = new Date(r.date_time);
      due.setDate(due.getDate() - r.remind_days_before);
      return { ...r, due_day: dayKey(due), overdue: dayKey(due) < today };
    })
    .filter((r) => r.due_day <= today);
}

function buildMessage(r) {
  const first = r.patient.split(' ')[0];
  const lines = [
    `🩺 *Olá, ${first}!*`,
    `Lembrete de consulta: ${formatDateTime(r.date_time)}`,
  ];
  if (r.doctor || r.specialty) lines.push(`👨‍⚕️ ${[r.doctor, r.specialty].filter(Boolean).join(' – ')}`);
  const place = r.location || r.doctor_address;
  if (place) lines.push(`📍 ${place}`);
  if (r.bring) lines.push(`📋 Levar: ${r.bring}`);
  lines.push('', 'Responda *1* para confirmar ou *2* para remarcar.');
  return lines.join('\n');
}

// Só dígitos; números brasileiros sem DDI ganham o 55 na frente
function normalizePhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits;
}

function whatsappLink(r) {
  return `https://wa.me/${normalizePhone(r.whatsapp)}?text=${encodeURIComponent(buildMessage(r))}`;
}

module.exports = { pendingReminders, whatsappLink, buildMessage, normalizePhone, formatDateTime };
