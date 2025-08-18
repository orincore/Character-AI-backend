import { sendEmail } from '../src/services/email.service.js';
import env from '../src/config/env.js';

async function main() {
  try {
    const to = process.argv[2] || process.env.TEST_EMAIL;
    if (!to) {
      console.error('Usage: node scripts/send-test-email.js <recipient-email>');
      console.error('Or set TEST_EMAIL in your environment.');
      process.exit(1);
    }

    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
      console.error('Missing SMTP configuration. Please set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
      process.exit(1);
    }

    const subject = 'Test email from Character AI backend';
    const text = 'This is a test email sent using your SMTP settings.';
    const html = '<p>This is a <strong>test email</strong> sent using your SMTP settings.</p>';

    const info = await sendEmail({ to, subject, text, html });
    console.log('Email sent! MessageId:', info.messageId);
    if (info.response) console.log('SMTP response:', info.response);
    if (info.envelope) console.log('Envelope:', info.envelope);
    if (info.accepted && info.accepted.length) {
      console.log('Accepted:', info.accepted.join(', '));
    }
    if (info.rejected && info.rejected.length) {
      console.warn('Rejected:', info.rejected.join(', '));
    }
  } catch (err) {
    console.error('Failed to send test email:', err?.message || err);
    process.exit(1);
  }
}

main();
