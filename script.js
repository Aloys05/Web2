document.addEventListener('DOMContentLoaded', () => {
  const loginTrigger = document.getElementById('loginTrigger');
  const signupTrigger = document.getElementById('signupTrigger');
  const heroView = document.getElementById('heroView');
  const authView = document.getElementById('authView');
  const loginPanel = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const footerToggle = document.getElementById('footerToggle');
  const footerNav = document.getElementById('footerNav');
  const themeToggle = document.getElementById('themeToggle');

  function showAuth(which) {
    if (!heroView || !authView || !loginPanel || !signupPanel) return;
    heroView.hidden = true;
    authView.hidden = false;
    loginPanel.hidden = which !== 'login';
    signupPanel.hidden = which !== 'signup';
    if (loginTrigger) loginTrigger.setAttribute('aria-pressed', String(which === 'login'));
    if (signupTrigger) signupTrigger.setAttribute('aria-pressed', String(which === 'signup'));

    const panel = which === 'login' ? loginPanel : signupPanel;
    const firstField = panel.querySelector('input');
    if (firstField) firstField.focus();
  }

  function showHero() {
    if (!authView || !heroView) return;
    authView.hidden = true;
    heroView.hidden = false;
    if (loginTrigger) loginTrigger.setAttribute('aria-pressed', 'false');
    if (signupTrigger) signupTrigger.setAttribute('aria-pressed', 'false');
  }

  // Only wire these up if the inline auth view exists on this page
  if (loginTrigger && authView) loginTrigger.addEventListener('click', () => showAuth('login'));
  if (signupTrigger && authView) signupTrigger.addEventListener('click', () => showAuth('signup'));

  document.querySelectorAll('[data-switch-to]').forEach(btn => {
    btn.addEventListener('click', () => showAuth(btn.dataset.switchTo));
  });

  document.addEventListener('keydown', (e) => {
    if (authView && !authView.hidden && e.key === 'Escape') showHero();
  });

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      console.log('Log in submitted — connect this to your backend.');
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', (e) => {
      e.preventDefault();
      console.log('Sign up submitted — connect this to your backend.');
    });
  }

  if (footerToggle && footerNav) {
    footerToggle.addEventListener('click', () => {
      const isOpen = footerToggle.getAttribute('aria-expanded') === 'true';
      footerToggle.setAttribute('aria-expanded', String(!isOpen));
      footerNav.hidden = isOpen;
    });
  }

  if (themeToggle) {
    const root = document.documentElement;

    function applyTheme(theme) {
      if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        themeToggle.textContent = '☀️';
        themeToggle.setAttribute('aria-pressed', 'true');
      } else {
        root.removeAttribute('data-theme');
        themeToggle.textContent = '🌙';
        themeToggle.setAttribute('aria-pressed', 'false');
      }
      localStorage.setItem('theme', theme);
    }

    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

    themeToggle.addEventListener('click', () => {
      const isDark = root.getAttribute('data-theme') === 'dark';
      applyTheme(isDark ? 'light' : 'dark');
    });
  }
});