const { Resend } = require('resend');

const FROM    = 'ModernSocial <diana.castillo@futurotek.com>';
const OWNER   = 'dianahelene@gmail.com';

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // silently skip if not configured
  const resend = new Resend(key);
  await resend.emails.send({ from: FROM, to, subject, html });
}

function contactNotificationEmail(lead) {
  const rows = [
    ['Name',          lead.name],
    ['Phone',         lead.phone         || '—'],
    ['Email',         lead.email         || '—'],
    ['Business',      lead.businessName  || '—'],
    ['Business type', lead.businessType  || '—'],
    ['Message',       lead.notes         || '—'],
  ];

  const tableRows = rows.map(([label, value]) =>
    `<tr>
       <td style="padding:6px 12px 6px 0;color:#888;font-size:14px;white-space:nowrap;vertical-align:top">${label}</td>
       <td style="padding:6px 0;font-size:14px;color:#111">${value}</td>
     </tr>`
  ).join('');

  return `
<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f5f5f5;margin:0;padding:32px 0">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;border:1px solid #e8e8e8">
  <div style="background:#1a1a28;padding:20px 28px">
    <span style="color:#c8a84b;font-size:18px;font-weight:600">✦ ModernSocial.app</span>
  </div>
  <div style="padding:24px 28px">
    <h2 style="margin:0 0 16px;font-size:18px;color:#111">New contact message</h2>
    <table style="border-collapse:collapse;width:100%">${tableRows}</table>
    <div style="margin-top:24px">
      <a href="https://socialai-production-4507.up.railway.app/admin/leads"
         style="display:inline-block;padding:10px 20px;background:#c8a84b;color:#1a1200;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">
        View in Admin →
      </a>
    </div>
  </div>
</div>
</body></html>`;
}

module.exports = { sendEmail, contactNotificationEmail, OWNER };
