import admin from 'firebase-admin';
import env from './env.js';

let initialized = false;

export function getFirebaseApp() {
  if (initialized) return admin;

  const hasCreds = !!(env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY);
  if (!hasCreds) {
    console.warn('[firebase] Admin not configured; missing env. Push notifications will be disabled.');
    return null;
  }
  try {
    const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      })
    });
    initialized = true;
    console.log('[firebase] Admin initialized');
  } catch (e) {
    console.warn('[firebase] Failed to init admin:', e?.message || e);
    return null;
  }
  return admin;
}
