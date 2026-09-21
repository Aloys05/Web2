document.addEventListener('DOMContentLoaded', () => {
  const loginTrigger = document.getElementById('loginTrigger');
  const signupTrigger = document.getElementById('signupTrigger');
  const heroView = document.getElementById('heroView');
  const authView = document.getElementById('authView');
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');

  function showAuth(which) {
    heroView.hidden = true;
    authView.hidden = false;
    loginPanel.hidden = which !== 'login';
    signupPanel.hidden = which !== 'signup';
    loginTrigger.setAttribute('aria-pressed', String(which === 'login'));
    signupTrigger.setAttribute('aria-pressed', String(which === 'signup'));

    const panel = which === 'login' ? loginPanel : signupPanel;
    const firstField = panel.querySelector('input');
    if (firstField) firstField.focus();
  }

  function showHero() {
    authView.hidden = true;
    heroView.hidden = false;
    loginTrigger.setAttribute('aria-pressed', 'false');
    signupTrigger.setAttribute('aria-pressed', 'false');
  }

  loginTrigger.addEventListener('click', () => showAuth('login'));
  signupTrigger.addEventListener('click', () => showAuth('signup'));

  // Switch between login/signup from within a panel
  document.querySelectorAll('[data-switch-to]').forEach(btn => {
    btn.addEventListener('click', () => showAuth(btn.dataset.switchTo));
  });

  // Escape brings back the browsing view
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !authView.hidden) showHero();
  });

  // Demo submit handlers (replace with real requests to your backend)
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    console.log('Log in submitted — connect this to your backend.');
  });

  document.getElementById('signupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    console.log('Sign up submitted — connect this to your backend.');
  });
});