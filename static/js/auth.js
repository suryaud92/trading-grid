/* auth.js — Google sign-in gate (Firebase Auth), single superadmin.
 *
 * This module decides whether App.start() ever runs. That is a CONVENIENCE,
 * not the security boundary: the static bundle is public and anyone can call
 * the API directly, so the real check is auth.py verifying the ID token and
 * the email on every request. This file just keeps an unauthorised person
 * looking at a sign-in screen instead of an empty grid.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut,
  onAuthStateChanged, setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const gate     = document.getElementById('gate');
const gateMsg  = document.getElementById('gate-msg');
const gateBtn  = document.getElementById('gate-signin');
const gateSpin = document.getElementById('gate-spinner');
const userChip = document.getElementById('user-chip');
const userMail = document.getElementById('user-email');
const signOutB = document.getElementById('sign-out');

let firebaseAuth = null;
let currentUser = null;
let started = false;

const Auth = {
  enabled: false,

  /** Fresh ID token for the API layer (the SDK refreshes it as needed). */
  async token() {
    if (!firebaseAuth || !currentUser) return null;
    try {
      return await currentUser.getIdToken();
    } catch (err) {
      console.warn('[auth] token refresh failed', err);
      return null;
    }
  },

  /** Called by feeds.js when the backend answers 401/403. */
  onRejected(message) {
    if (!Auth.enabled) return;
    showGate(message);
  },

  signOut() {
    if (firebaseAuth) signOut(firebaseAuth);
  },
};
window.Auth = Auth;

function showGate(message, busy) {
  gate.hidden = false;
  gate.classList.toggle('busy', !!busy);
  gateSpin.hidden = !busy;
  gateBtn.hidden = !!busy;
  gateMsg.textContent = message || '';
  gateMsg.classList.toggle('error', !!message);
  userChip.hidden = true;
}

function hideGate() {
  gate.hidden = true;
  gate.classList.remove('busy');
}

function startAppOnce() {
  if (started) return;
  started = true;
  window.App.start();
}

async function boot() {
  let config;
  try {
    config = await window.Feeds.api.config();
  } catch (err) {
    showGate('Backend unreachable: ' + err.message);
    return;
  }

  /* Auth off (local dev): straight into the app. */
  if (!config.authEnabled) {
    Auth.enabled = false;
    hideGate();
    userChip.hidden = true;
    startAppOnce();
    return;
  }

  Auth.enabled = true;
  if (!config.firebase || !config.firebase.apiKey) {
    showGate('Sign-in is enabled on the server but FIREBASE_WEB_CONFIG is missing, '
      + 'so the browser cannot start Firebase. Set it and redeploy.');
    return;
  }

  const app = initializeApp(config.firebase);
  firebaseAuth = getAuth(app);
  try {
    await setPersistence(firebaseAuth, browserLocalPersistence);
  } catch (_) { /* private windows: fall back to in-memory */ }

  onAuthStateChanged(firebaseAuth, async (user) => {
    currentUser = user;
    if (!user) {
      showGate('');
      return;
    }
    showGate('Checking your account…', true);
    try {
      /* The server decides. A non-superadmin gets a 403 here. */
      await window.Feeds.api.settings();
      userMail.textContent = user.email;
      userChip.hidden = false;
      hideGate();
      startAppOnce();
    } catch (err) {
      await signOut(firebaseAuth);
      showGate(err.message || 'This account is not authorised for this app.');
    }
  });

  gateBtn.addEventListener('click', async () => {
    showGate('', true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(firebaseAuth, provider);
    } catch (err) {
      const msg = err && err.code === 'auth/popup-blocked'
        ? 'Your browser blocked the sign-in popup — allow popups and try again.'
        : (err && err.message) || 'Sign-in failed.';
      showGate(msg);
    }
  });

  signOutB.addEventListener('click', () => Auth.signOut());
}

boot();
