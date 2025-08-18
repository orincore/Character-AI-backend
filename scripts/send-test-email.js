import { sendEmail, buildOtpEmail, buildWelcomeEmail } from '../src/services/email.service.js';
import env from '../src/config/env.js';

async function main() {
  try {
    const to = process.argv[2] || process.env.TEST_EMAIL;
    const kind = (process.argv[3] || '').toLowerCase(); // '', 'otp', 'welcome'
    if (!to) {
      console.error('Usage: node scripts/send-test-email.js <recipient-email> [otp|welcome]');
      console.error('Or set TEST_EMAIL in your environment.');
      process.exit(1);
    }

    if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
      console.error('Missing SMTP configuration. Please set SMTP_HOST, SMTP_USER, SMTP_PASS in .env');
      process.exit(1);
    }

    let subject, text, html;
    if (kind === 'otp') {
      const otp = '123456';
      const built = buildOtpEmail({ name: 'Tester', otp, minutes: 10, appName: env.APP_NAME, ctaUrl: env.APP_URL });
      ({ subject, text, html } = built);
    } else if (kind === 'welcome') {
      const built = buildWelcomeEmail({ name: 'Tester', appName: env.APP_NAME, ctaUrl: env.APP_URL ? `${env.APP_URL.replace(/\/$/, '')}/characters/new` : '' });
      ({ subject, text, html } = built);
    } else {
      subject = 'Test email from Character AI backend';
      text = 'This is a test email sent using your SMTP settings.';
      html = '<p>This is a <strong>test email</strong> sent using your SMTP settings.</p>';
    }

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
