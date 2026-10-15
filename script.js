const STORAGE_KEYS = {
  cart: 'aloswift_cart',
};

let stagedProductPhotos = [];
let currentUser = null;
let productsCache = [];
let activeConversationId = null;
const trackedProductViews = new Set();
let adminProductsCache = [];

document.addEventListener('DOMContentLoaded', async () => {
  initFooterMenu();
  initThemeToggle();
  initAuthForms();
  await loadPublicProducts();
  initLivingDisplay();
  await initShop();
});

function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Unable to read AloSwift data from "${key}".`, error);
    showToast('Some saved data could not be read. Refresh or clear this site’s local storage to recover.');
    return fallback;
  }
}

async function renderMyReviews(containerId) {
  const container = document.getElementById(containerId);
  try {
    const result = await apiRequest('/api/my-reviews');
    container.innerHTML = result.reviews.length
      ? result.reviews.map(review => `<article class="review-card">
          <div><strong>From ${escapeHtml(review.reviewer_name)}</strong><span class="review-stars" aria-label="${review.stars} out of 5 stars">${'★'.repeat(review.stars)}${'☆'.repeat(5 - review.stars)}</span></div>
          <p>${escapeHtml(review.comment)}</p><small>${escapeHtml(new Date(review.created_at).toLocaleDateString())}</small>
        </article>`).join('')
      : '<p>No reviews yet. Reviews are available after an enquiry.</p>';
  } catch (error) {
    container.textContent = error.message || 'Your reviews could not be loaded.';
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save AloSwift data to "${key}".`, error);
    showToast('Your changes could not be saved. Check the available browser storage and try again.');
    throw error;
  }
}

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      ...options,
    });
  } catch (error) {
    throw new Error('AloSwift could not reach its server. Start it with npm start and open http://localhost:3000.');
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `The request failed (${response.status}).`);
  return result;
}

function requestJson(url, method, body) {
  return apiRequest(url, { method, body: JSON.stringify(body) });
}

function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('toast--visible');
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => toast.classList.remove('toast--visible'), 3200);
}

function initFooterMenu() {
  const toggle = document.getElementById('footerToggle');
  const nav = document.getElementById('footerNav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    nav.hidden = expanded;
  });
}

function initThemeToggle() {
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;
  const root = document.documentElement;

  function applyTheme(theme) {
    const dark = theme === 'dark';
    root.toggleAttribute('data-theme', dark);
    if (dark) root.setAttribute('data-theme', 'dark');
    toggle.textContent = dark ? '☀️' : '🌙';
    toggle.setAttribute('aria-pressed', String(dark));
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }

  applyTheme(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  toggle.addEventListener('click', () => {
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });
}

function initLivingDisplay() {
  const host = document.querySelector('.shop-hero, .hero, .contact');
  if (!host) return;
  const previous = host.querySelector('.living-display');
  if (previous) previous.remove();
  const cards = getProducts()
    .flatMap(getProductImages)
    .filter(image => safeImageUrl(image))
    .slice(0, 8);
  const fallbackIcons = ['bx-shopping-bag', 'bx-t-shirt', 'bx-home-heart', 'bx-watch', 'bx-cube', 'bx-palette', 'bx-leaf', 'bx-camera'];
  const items = Array.from({ length: 8 }, (_, index) => {
    const productImage = cards[index % Math.max(cards.length, 1)];
    if (productImage) {
      const image = safeImageUrl(productImage);
      if (image) return `<span class="living-display__item"><img src="${escapeHtml(image)}" alt="" loading="lazy"></span>`;
    }
    return `<span class="living-display__item living-display__item--icon"><i class="bx ${fallbackIcons[index]}" aria-hidden="true"></i></span>`;
  }).join('');
  const display = document.createElement('div');
  display.className = 'living-display';
  display.setAttribute('aria-hidden', 'true');
  display.innerHTML = `<div class="living-display__track living-display__track--forward">${items}${items}</div>
    <div class="living-display__track living-display__track--reverse">${items}${items}</div>`;
  host.prepend(display);
}

async function loadPublicProducts() {
  try {
    const catalog = await apiRequest('/api/products');
    productsCache = catalog.products;
  } catch (error) {
    console.error('Public marketplace products could not be loaded.', error);
    if (document.getElementById('productGrid')) {
      showToast(error.message || 'The marketplace could not be loaded. Please try again.');
    }
  }
}

function showAuthFeedback(form, message, isError) {
  let feedback = form.querySelector('.auth-feedback');
  if (!feedback) {
    feedback = document.createElement('p');
    feedback.className = 'auth-feedback';
    feedback.setAttribute('role', 'status');
    form.append(feedback);
  }
  feedback.textContent = message;
  feedback.classList.toggle('auth-feedback--error', Boolean(isError));
}

function initAuthForms() {
  const signupForm = document.getElementById('signupForm');
  const loginForm = document.getElementById('loginForm');
  const loginTrigger = document.getElementById('loginTrigger');
  const signupTrigger = document.getElementById('signupTrigger');
  const roleSelect = signupForm && signupForm.elements.namedItem('role');
  if (loginTrigger) loginTrigger.addEventListener('click', () => { window.location.href = 'login.html'; });
  if (signupTrigger) signupTrigger.addEventListener('click', () => { window.location.href = 'signup.html'; });
  if (roleSelect && new URLSearchParams(window.location.search).get('role') === 'supplier') {
    roleSelect.value = 'supplier';
  }
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener('click', async event => {
      event.preventDefault();
      try {
        const config = await apiRequest('/api/site-config');
        if (!config.adminEmail) throw new Error('Admin email is not configured. Please contact the site owner.');
        const email = loginForm.elements.namedItem('email').value.trim();
        const subject = 'AloSwift account access help';
        const body = `Hello AloSwift admin,%0D%0A%0D%0AI need help regaining access to my account.${email ? `%0D%0AMy account email is: ${encodeURIComponent(email)}` : ''}%0D%0APlease help me reset my password.`;
        window.location.href = `mailto:${encodeURIComponent(config.adminEmail)}?subject=${encodeURIComponent(subject)}&body=${body}`;
      } catch (error) {
        showAuthFeedback(loginForm, error.message || 'The admin could not be reached.', true);
      }
    });
  }

  if (signupForm) {
    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;

      try {
        const account = await requestJson('/api/auth/signup', 'POST', {
          name: String(values.get('name') || '').trim(),
          email: String(values.get('email') || '').trim().toLowerCase(),
          password: String(values.get('password') || ''),
          role: String(values.get('role') || 'customer'),
        });
        activateAccount(account.user);
        window.location.href = 'shop.html';
      } catch (error) {
        showAuthFeedback(form, error.message || 'Your account could not be created. Please try again.', true);
      } finally {
        submit.disabled = false;
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;

      try {
        const result = await requestJson('/api/auth/login', 'POST', {
          email: String(values.get('email') || '').trim().toLowerCase(),
          password: String(values.get('password') || ''),
        });
        activateAccount(result.user);
        window.location.href = 'shop.html';
      } catch (error) {
        showAuthFeedback(form, error.message || 'You could not be signed in. Please try again.', true);
      } finally {
        submit.disabled = false;
      }
    });
  }
}

function activateAccount(account) {
  if (!account || !currentUser || currentUser.id !== account.id) activeConversationId = null;
  currentUser = account || null;
}

function getCurrentUser() {
  return currentUser;
}

function getAccount(userId) {
  if (currentUser && currentUser.id === userId) return currentUser;
  const product = productsCache.find(item => item.ownerId === userId);
  return product ? product.supplier : null;
}

function profileComplete(user) {
  if (!user || !user.profile || !user.profile.avatar) return false;
  const required = ['phone', 'town', 'city', 'region', 'country'];
  if (required.some(key => !String(user.profile[key] || '').trim())) return false;
  return user.role !== 'supplier' || Boolean(String(user.profile.businessName || '').trim());
}

function initProfile() {
  const form = document.getElementById('profileForm');
  const user = getCurrentUser();
  if (!form || !user || user.role === 'admin') return;
  renderProfileForm();
  if (!profileComplete(user)) openCustomerDashboard();
}

function renderProfileForm() {
  const user = getCurrentUser();
  if (!user) return;
  const form = document.getElementById('profileForm');
  const profile = user.profile || {};
  form.elements.namedItem('name').value = user.name || '';
  form.elements.namedItem('email').value = user.email || '';
  for (const key of ['phone', 'town', 'city', 'region', 'country', 'businessName', 'businessId', 'bio']) {
    form.elements.namedItem(key).value = profile[key] || '';
  }
  const supplier = user.role === 'supplier';
  document.querySelectorAll('.profile-field--supplier').forEach(field => { field.hidden = !supplier; });
  document.getElementById('profilePrivacyNote').textContent = supplier
    ? 'Your supplier profile is visible to shoppers alongside your listings. Keep your contact and location details up to date.'
    : 'Your profile stays private. Your name, contact details and town are shared with a supplier only when you choose to send an enquiry.';
  const avatar = document.getElementById('profilePhotoPreview');
  const placeholder = document.getElementById('profilePhotoPlaceholder');
  avatar.hidden = !profile.avatar;
  avatar.src = profile.avatar || '';
  placeholder.hidden = Boolean(profile.avatar);
  document.getElementById('accountProfileCard').innerHTML = profileCardMarkup(user);
  document.getElementById('accountProfileCard').classList.toggle('profile-card--incomplete', !profileComplete(user));
  document.getElementById('editProfileButton').hidden = false;
}

function profileCardMarkup(user) {
  const profile = user.profile || {};
  const name = user.name || user.email || 'AloSwift member';
  const business = user.role === 'supplier' ? profile.businessName || 'Supplier profile' : 'Customer account';
  const image = safeImageUrl(profile.avatar);
  return `<div class="profile-card__avatar">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="bx bx-user" aria-hidden="true"></i>'}</div>
    <p class="section-eyebrow">${user.role === 'supplier' ? 'SUPPLIER PROFILE' : 'CUSTOMER PROFILE'}</p>
    <h3>${escapeHtml(business)}</h3>
    <p class="profile-card__name">${escapeHtml(name)}</p>
    <ul class="profile-card__details">
      <li><i class="bx bx-envelope" aria-hidden="true"></i>${escapeHtml(user.email || '')}</li>
      ${profile.phone ? `<li><i class="bx bx-phone" aria-hidden="true"></i>${escapeHtml(profile.phone)}</li>` : ''}
      ${profile.town || profile.city ? `<li><i class="bx bx-map" aria-hidden="true"></i>${escapeHtml([profile.town, profile.city, profile.region, profile.country].filter(Boolean).join(', '))}</li>` : ''}
      ${user.role === 'supplier' && profile.businessId ? `<li><i class="bx bx-badge-check" aria-hidden="true"></i>${escapeHtml(profile.businessId)}</li>` : ''}
    </ul>
    ${profile.bio ? `<p class="profile-card__bio">${escapeHtml(profile.bio)}</p>` : ''}
    ${profileComplete(user) ? '' : '<p class="profile-card__incomplete">Complete the required details to contact sellers or publish products.</p>'}`;
}

async function saveProfile(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user) {
    showToast('Please sign in again before updating your profile.');
    return;
  }
  const form = event.currentTarget;
  const values = new FormData(form);
  const photoFile = document.getElementById('profilePhoto').files[0];
  const profile = {
    ...(user.profile || {}),
    phone: String(values.get('phone') || '').trim(),
    town: String(values.get('town') || '').trim(),
    city: String(values.get('city') || '').trim(),
    region: String(values.get('region') || '').trim(),
    country: String(values.get('country') || '').trim(),
    businessName: String(values.get('businessName') || '').trim(),
    businessId: String(values.get('businessId') || '').trim(),
    bio: String(values.get('bio') || '').trim(),
  };
  const name = String(values.get('name') || '').trim();
  if (!name || Object.values(profile).slice(0, 5).some(value => !value)) {
    showToast('Please complete your name, phone and full location before saving.');
    return;
  }
  if (user.role === 'supplier' && !profile.businessName) {
    showToast('Please add your public shop or business name.');
    return;
  }
  if (!photoFile && !(user.profile && user.profile.avatar)) {
    showToast('Choose a profile picture before saving your profile.');
    return;
  }
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    profile.avatar = photoFile ? await compressImage(photoFile, 480) : user.profile.avatar;
    const result = await requestJson('/api/profile', 'PUT', { name, profile });
    activateAccount(result.user);
    renderProfileForm();
    renderHeader();
    renderCatalog();
    showToast('Your profile has been saved.');
  } catch (error) {
    showToast(error.message || 'Your profile could not be saved. Please try again.');
  } finally {
    submit.disabled = false;
  }
}

function initPhotoDropzone(dropzoneId, inputId) {
  const dropzone = document.getElementById(dropzoneId);
  const input = document.getElementById(inputId);
  if (!dropzone || !input) return;
  dropzone.addEventListener('dragover', event => {
    event.preventDefault();
    dropzone.classList.add('photo-dropzone--active');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('photo-dropzone--active'));
  dropzone.addEventListener('drop', event => {
    event.preventDefault();
    dropzone.classList.remove('photo-dropzone--active');
    const files = Array.from(event.dataTransfer.files).filter(file => file.type.startsWith('image/'));
    if (!files.length) {
      showToast('Choose an image file to upload.');
      return;
    }
    const transfer = new DataTransfer();
    files.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function previewProfilePhoto(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    showToast('Choose an image file for your profile picture.');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast('Choose a profile picture smaller than 8 MB.');
    return;
  }
  const preview = document.getElementById('profilePhotoPreview');
  preview.src = URL.createObjectURL(file);
  preview.hidden = false;
  document.getElementById('profilePhotoPlaceholder').hidden = true;
}

function updateProductPhotoPreview() {
  const input = document.getElementById('productPhotos');
  if (!input) return;
  const selected = Array.from(input.files || []);
  if (selected.length) stagedProductPhotos = selected;
  const previews = document.getElementById('productPhotoPreviews');
  const label = document.getElementById('productPhotoLabel');
  previews.innerHTML = '';
  stagedProductPhotos.forEach(file => {
    const image = document.createElement('img');
    image.src = URL.createObjectURL(file);
    image.alt = `${file.name} preview`;
    previews.append(image);
  });
  label.textContent = stagedProductPhotos.length
    ? `${stagedProductPhotos.length} ${stagedProductPhotos.length === 1 ? 'photo' : 'photos'} selected`
    : 'Choose photos or drop them here';
}

function compressImage(file, maxDimension = 1200) {
  if (!file.type.startsWith('image/')) return Promise.reject(new Error('Choose a valid image file.'));
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('Choose images smaller than 8 MB each.'));
  return createImageBitmap(file).then(bitmap => {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not prepare the selected image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) {
          reject(new Error('This image could not be processed. Please try another file.'));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('This image could not be read.'));
        reader.readAsDataURL(blob);
      }, 'image/jpeg', 0.82);
    });
  }).catch(error => {
    if (error instanceof Error && error.message) throw error;
    throw new Error('This image could not be processed. Please try another file.');
  });
}

async function openPublicProfile(userId) {
  const account = getAccount(userId);
  if (!account || account.role !== 'supplier' || !profileComplete(account)) {
    showToast('This supplier has not completed their public profile yet.');
    return;
  }
  document.getElementById('publicProfileContent').innerHTML = profileCardMarkup(account);
  document.getElementById('publicProfileContent').insertAdjacentHTML('beforeend', `
    <div class="public-profile__contact">
      <a href="mailto:${encodeURIComponent(account.email)}"><i class="bx bx-envelope" aria-hidden="true"></i> Email supplier</a>
      <a href="tel:${escapeHtml(account.profile.phone.replace(/[^\d+]/g, ''))}"><i class="bx bx-phone" aria-hidden="true"></i> Call supplier</a>
    </div>
    ${currentUser && currentUser.id !== account.id
      ? `<button class="field-submit" type="button" data-contact-profile="${escapeHtml(account.id)}">Open messages</button>
        <button class="text-button report-account-button" type="button" data-report-user="${escapeHtml(account.id)}">Report this account</button>` : ''}`);
  try {
    const result = await apiRequest(`/api/users/${encodeURIComponent(account.id)}/reviews`);
    const reviews = result.reviews.map(review => `<article class="review-card">
      <div><strong>${escapeHtml(review.reviewer_name)}</strong><span class="review-stars" aria-label="${review.stars} out of 5 stars">${'★'.repeat(review.stars)}${'☆'.repeat(5 - review.stars)}</span></div>
      <p>${escapeHtml(review.comment)}</p><small>${escapeHtml(new Date(review.created_at).toLocaleDateString())}</small>
    </article>`).join('');
    const reviewForm = currentUser && currentUser.role === 'customer' && currentUser.id !== account.id
      ? `<form class="review-form profile-review-form" id="supplierReviewForm" data-target-id="${escapeHtml(account.id)}">
          <h3>Review this supplier</h3>
          <label class="field"><span>Rating</span><select name="stars" required><option value="">Choose stars</option><option value="5">★★★★★ — Excellent</option><option value="4">★★★★ — Good</option><option value="3">★★★ — Fair</option><option value="2">★★ — Poor</option><option value="1">★ — Very poor</option></select></label>
          <label class="field"><span>Comment</span><textarea name="comment" maxlength="1000" required></textarea></label>
          <button class="field-submit" type="submit">Submit review</button>
        </form>` : '';
    document.getElementById('publicProfileContent').insertAdjacentHTML('beforeend', `
      <section class="profile-reviews"><h3>Reviews (${result.count}) ${result.count ? `· ${Number(result.average).toFixed(1)} / 5` : ''}</h3>
        ${reviews || '<p>No reviews yet. Reviews can be left after a recorded enquiry.</p>'}
        ${reviewForm}</section>`);
  } catch (error) {
    console.error('Supplier reviews could not be loaded.', error);
    document.getElementById('publicProfileContent').insertAdjacentHTML('beforeend', '<p class="auth-feedback auth-feedback--error">Reviews could not be loaded. Please try again.</p>');
  }
  document.getElementById('editProfileButton').hidden = true;
  const profileDialog = document.getElementById('profileDialog');
  if (!profileDialog.open) profileDialog.showModal();
}

async function openInquiry(productId) {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (!profileComplete(user)) {
    showToast('Complete your profile and add a profile picture before contacting a supplier.');
    openCustomerDashboard();
    return;
  }
  const product = getProducts().find(item => item.id === productId);
  const supplier = product && getAccount(product.ownerId);
  if (!product || !supplier || supplier.role !== 'supplier' || !profileComplete(supplier)) {
    showToast('This supplier is not ready to receive enquiries yet.');
    return;
  }
  try {
    const result = await requestJson('/api/conversations', 'POST', { productId: product.id });
    await openMessagesDialog(result.conversationId);
  } catch (error) {
    showToast(error.message || 'A conversation could not be started.');
  }
}

async function openDirectConversation(peerId) {
  try {
    const result = await requestJson('/api/conversations', 'POST', { peerId });
    await openMessagesDialog(result.conversationId);
  } catch (error) {
    showToast(error.message || 'A conversation could not be started.');
  }
}

async function initShop() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  try {
    const session = await apiRequest('/api/session');
    activateAccount(session.user);
    if (currentUser && currentUser.role === 'supplier') {
      const managed = await apiRequest('/api/supplier/products');
      const byId = new Map(productsCache.map(product => [product.id, product]));
      managed.products.forEach(product => {
        if (!byId.has(product.id)) byId.set(product.id, { ...product, supplier: currentUser });
      });
      productsCache = [...byId.values()];
    }
  } catch (error) {
    console.error('Marketplace data could not be loaded.', error);
    showToast(error.message || 'The marketplace could not be loaded. Please try again.');
  }
  initLivingDisplay();
  renderHeader();
  initProfile();
  renderCatalog();
  renderCart();

  document.getElementById('productSearch').addEventListener('input', renderCatalog);
  document.getElementById('categoryFilter').addEventListener('change', renderCatalog);
  document.getElementById('sortProducts').addEventListener('change', renderCatalog);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('productSearch').value = '';
    document.getElementById('categoryFilter').value = 'all';
    document.getElementById('sortProducts').value = 'featured';
    renderCatalog();
  });
  grid.addEventListener('click', event => {
    const productCard = event.target.closest('[data-track-product]');
    if (productCard) trackProductView(productCard.dataset.trackProduct);
    const button = event.target.closest('[data-add-to-cart]');
    if (button) addToCart(button.dataset.addToCart);
    const contactButton = event.target.closest('[data-contact-seller]');
    if (contactButton) openInquiry(contactButton.dataset.contactSeller);
    const sellerButton = event.target.closest('[data-view-seller]');
    if (sellerButton) openPublicProfile(sellerButton.dataset.viewSeller);
  });

  document.getElementById('profileTrigger').addEventListener('click', () => {
    if (currentUser && currentUser.role === 'admin') openAdminDashboard();
    else openCustomerDashboard();
  });
  document.getElementById('listingTrigger').addEventListener('click', () => {
    const user = getCurrentUser();
    if (user && user.role === 'admin') openAdminDashboard();
    else if (user && user.role === 'supplier') openSupplierDashboard();
    else openCustomerDashboard();
  });
  document.getElementById('supplierCta').addEventListener('click', event => {
    const user = getCurrentUser();
    if (!user) return;
    event.preventDefault();
    if (user.role === 'admin') openAdminDashboard();
    else if (user.role === 'supplier') openSupplierDashboard();
    else openCustomerDashboard();
  });
  document.getElementById('backToShopFromAccount').addEventListener('click', closeSupplierDashboard);
  document.getElementById('backToShop').addEventListener('click', closeSupplierDashboard);
  document.getElementById('productForm').addEventListener('submit', saveProduct);
  document.getElementById('cancelEdit').addEventListener('click', resetProductForm);
  document.getElementById('sellerProducts').addEventListener('click', handleSellerProductAction);
  document.getElementById('profileForm').addEventListener('submit', saveProfile);
  document.getElementById('customerReviewForm').addEventListener('submit', submitCustomerReview);
  document.getElementById('supplierReportForm').addEventListener('submit', submitSupplierReport);
  document.getElementById('editProfileButton').addEventListener('click', () => {
    document.getElementById('profileDialog').close();
    openCustomerDashboard();
  });
  document.getElementById('profilePhoto').addEventListener('change', event => previewProfilePhoto(event.target.files[0]));
  initPhotoDropzone('profileDropzone', 'profilePhoto');
  document.getElementById('productPhotos').addEventListener('change', updateProductPhotoPreview);
  initPhotoDropzone('productDropzone', 'productPhotos');
  document.getElementById('logoutTrigger').addEventListener('click', async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      activateAccount(null);
      closeSupplierDashboard();
      renderHeader();
      showToast('You have signed out.');
    } catch (error) {
      showToast(error.message || 'You could not be signed out. Please try again.');
    }
  });

  document.getElementById('cartTrigger').addEventListener('click', () => document.getElementById('cartDialog').showModal());
  document.getElementById('closeCart').addEventListener('click', () => document.getElementById('cartDialog').close());
  document.getElementById('cartDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.getElementById('cartItems').addEventListener('click', event => {
    handleCartAction(event);
    const contactButton = event.target.closest('[data-contact-seller]');
    if (contactButton) {
      trackProductView(contactButton.dataset.contactSeller);
      document.getElementById('cartDialog').close();
      openInquiry(contactButton.dataset.contactSeller);
    }
  });
  document.getElementById('publicProfileContent').addEventListener('submit', event => {
    if (event.target.id === 'supplierReviewForm') submitSupplierReview(event);
  });
  document.getElementById('publicProfileContent').addEventListener('click', event => {
    const button = event.target.closest('[data-report-user]');
    if (button) openReportDialog(button.dataset.reportUser);
  });
  document.getElementById('reportForm').addEventListener('submit', submitAccountReport);
  document.getElementById('closeReport').addEventListener('click', () => document.getElementById('reportDialog').close());
  document.getElementById('openMessages').addEventListener('click', () => openMessagesDialog());
  document.getElementById('closeMessages').addEventListener('click', () => document.getElementById('messagesDialog').close());
  document.getElementById('conversationList').addEventListener('click', event => {
    const button = event.target.closest('[data-conversation-id]');
    if (!button) return;
    activeConversationId = button.dataset.conversationId;
    openMessagesDialog(activeConversationId);
  });
  document.getElementById('conversationComposer').addEventListener('submit', sendConversationMessage);
  document.getElementById('startSupportConversation').addEventListener('click', () => openDirectConversation(''));
  document.getElementById('adminMessageForm').addEventListener('submit', submitAdminMessage);
  document.getElementById('refreshAdmin').addEventListener('click', renderAdminOverview);
  document.getElementById('adminOpenInbox').addEventListener('click', () => openMessagesDialog());
  document.getElementById('adminAccounts').addEventListener('click', handleAdminAccountAction);
  document.getElementById('adminReports').addEventListener('click', handleAdminReportAction);
  document.getElementById('adminProductFilter').addEventListener('input', event => renderAdminProducts(event.target.value));
  document.getElementById('publicProfileContent').addEventListener('click', event => {
    const button = event.target.closest('[data-contact-profile]');
    if (button) {
      document.getElementById('profileDialog').close();
      openDirectConversation(button.dataset.contactProfile);
    }
  });
  if (currentUser && currentUser.role === 'admin') openAdminDashboard();
}

function trackProductView(productId) {
  if (!productId || trackedProductViews.has(productId)) return;
  trackedProductViews.add(productId);
  apiRequest(`/api/products/${encodeURIComponent(productId)}/view`, { method: 'POST' })
    .catch(error => console.error('Product interest could not be recorded.', error));
}

function setActiveDashboard(activeId) {
  const sections = ['catalog', 'customerDashboard', 'supplierDashboard', 'adminDashboard'];
  sections.forEach(id => { document.getElementById(id).hidden = id !== activeId; });
  document.querySelector('.shop-hero').hidden = activeId !== 'catalog';
  document.querySelector('.supplier-callout').hidden = activeId !== 'catalog';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function openAdminDashboard() {
  if (!currentUser || currentUser.role !== 'admin') return;
  setActiveDashboard('adminDashboard');
  await renderAdminOverview();
}

async function renderAdminOverview() {
  try {
    const overview = await apiRequest('/api/admin/overview');
    document.getElementById('adminVisitorCount').textContent = overview.visitorCount.toLocaleString();
    document.getElementById('adminAccountCount').textContent = overview.accountCount.toLocaleString();
    document.getElementById('adminProductCount').textContent = overview.productCount.toLocaleString();
    document.getElementById('adminReportCount').textContent = overview.openReportCount.toLocaleString();
    document.getElementById('adminUnreadCount').textContent = overview.unreadMessageCount.toLocaleString();
    document.getElementById('adminAccounts').innerHTML = overview.users
      .filter(user => user.role !== 'admin')
      .map(user => {
        const location = user.profile
          ? [user.profile.town, user.profile.city, user.profile.region, user.profile.country].filter(Boolean).join(', ')
          : '';
        const contact = [
          user.profile && user.profile.phone,
          location,
          user.profile && user.profile.businessName,
          user.profile && user.profile.businessId,
          user.profile && user.profile.bio,
        ].filter(Boolean).join(' · ');
        const banLabel = user.bannedUntil === 'permanent'
          ? `Banned permanently${user.banReason ? `: ${user.banReason}` : ''}`
          : user.bannedUntil && Date.parse(user.bannedUntil) > Date.now()
            ? `Banned until ${new Date(user.bannedUntil).toLocaleString()}`
            : 'Active';
        return `<tr>
          <td><strong>${escapeHtml(user.name)}</strong><br><span>${escapeHtml(user.email)} · ${escapeHtml(user.role)}</span>${contact ? `<br><small>${escapeHtml(contact)}</small>` : ''}</td>
          <td>${escapeHtml(new Date(user.createdAt).toLocaleString())}</td>
          <td>${user.lastVisited ? escapeHtml(new Date(user.lastVisited).toLocaleString()) : 'No signed-in visit recorded'}</td>
          <td>${escapeHtml(banLabel)}</td>
          <td class="admin-actions">
            <select data-ban-duration="${escapeHtml(user.id)}" aria-label="Ban duration for ${escapeHtml(user.name)}"><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option><option value="8760">365 days</option><option value="0">Permanent</option></select>
            <button class="text-button" type="button" data-admin-action="ban" data-user-id="${escapeHtml(user.id)}">Ban</button>
            ${user.bannedUntil ? `<button class="text-button" type="button" data-admin-action="unban" data-user-id="${escapeHtml(user.id)}">Unban</button>` : ''}
            <button class="text-button text-button--danger" type="button" data-admin-action="delete" data-user-id="${escapeHtml(user.id)}">Delete</button>
          </td>
        </tr>`;
      }).join('');
    const recipients = overview.users.filter(user => user.role !== 'admin');
    const options = recipients.map(user => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} (${escapeHtml(user.email)})</option>`).join('');
    document.getElementById('adminMessageRecipient').innerHTML = `<option value="">Choose an account</option>${options}`;
    document.getElementById('adminReports').innerHTML = overview.reports.length
      ? overview.reports.map(report => `<article class="admin-list__item">
          <div><strong>${escapeHtml(report.subjectName)} · ${escapeHtml(report.reason)}</strong><span>${escapeHtml(report.subjectEmail)} · Reported by ${escapeHtml(report.reporterName)} (${escapeHtml(report.reporterEmail)}) · ${escapeHtml(new Date(report.createdAt).toLocaleString())}</span><p>${escapeHtml(report.details)}</p></div>
          ${report.status === 'open' ? `<button class="text-button" type="button" data-report-action="close" data-report-id="${escapeHtml(report.id)}">Mark reviewed</button>` : '<span>Reviewed</span>'}
        </article>`).join('')
      : '<p>No account reports have been submitted.</p>';
    document.getElementById('adminReviews').innerHTML = overview.reviews.length
      ? overview.reviews.map(review => `<article class="admin-list__item"><div>
          <strong>${escapeHtml(review.stars)} / 5 · ${escapeHtml(review.reviewee_name)} (${escapeHtml(review.reviewee_role)})</strong>
          <span>From ${escapeHtml(review.reviewer_name)} (${escapeHtml(review.reviewer_role)}) · ${escapeHtml(new Date(review.created_at).toLocaleString())}</span>
          <p>${escapeHtml(review.comment)}</p>
        </div></article>`).join('')
      : '<p>No reviews have been submitted.</p>';
    adminProductsCache = overview.products;
    renderAdminProducts(document.getElementById('adminProductFilter').value);
    document.getElementById('adminVisits').innerHTML = overview.visits.map(visit => `<tr>
      <td>${escapeHtml(visit.date)}</td><td>${Number(visit.visitors).toLocaleString()}</td><td>${Number(visit.pageVisits).toLocaleString()}</td>
    </tr>`).join('');
  } catch (error) {
    showToast(error.message || 'Admin data could not be loaded.');
  }

  function renderAdminProducts(filter = '') {
    const normalizedFilter = String(filter).trim().toLowerCase();
    const matches = adminProductsCache.filter(product =>
      `${product.name} ${product.description} ${product.supplier.name} ${product.supplier.email} ${product.category}`.toLowerCase().includes(normalizedFilter));
    document.getElementById('adminProducts').innerHTML = matches.length
      ? matches.map(product => {
        const image = safeImageUrl(product.image);
        return `<article class="admin-product-card">
          <div class="admin-product-card__image">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}">` : '<i class="bx bx-image" aria-hidden="true"></i>'}</div>
          <div class="admin-product-card__content"><strong>${escapeHtml(product.name)}</strong>
            <span>${escapeHtml(product.supplier.name)} · ${escapeHtml(product.supplier.email)} · ${escapeHtml(product.category)}</span>
            <p>${escapeHtml(product.description)}</p>
            <small>${formatPrice(product.price)} · ${Number(product.stock)} in stock · ${Number(product.uniqueViews || 0).toLocaleString()} unique interested visitors</small>
          </div>
        </article>`;
      }).join('')
      : '<p>No product listings match that filter.</p>';
  }
}

async function handleAdminAccountAction(event) {
  const button = event.target.closest('[data-admin-action]');
  if (!button) return;
  const userId = button.dataset.userId;
  try {
    if (button.dataset.adminAction === 'delete') {
      if (!window.confirm('Permanently delete this account and its listings? This cannot be undone.')) return;
      await apiRequest(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
      showToast('The account and its listings were deleted.');
    } else if (button.dataset.adminAction === 'unban') {
      await requestJson(`/api/admin/users/${encodeURIComponent(userId)}/ban`, 'POST', { durationHours: -1 });
      showToast('The account ban has been lifted.');
    } else {
      const reason = window.prompt('Why is this account being banned?');
      if (!reason || !reason.trim()) return;
      const durationHours = Number(document.querySelector(`[data-ban-duration="${CSS.escape(userId)}"]`).value);
      await requestJson(`/api/admin/users/${encodeURIComponent(userId)}/ban`, 'POST', { durationHours, reason: reason.trim() });
      showToast(durationHours ? 'The timed account ban has been applied.' : 'The permanent account ban has been applied.');
    }
    await renderAdminOverview();
  } catch (error) {
    showToast(error.message || 'That moderation action could not be completed.');
  }
}

async function handleAdminReportAction(event) {
  const button = event.target.closest('[data-report-action="close"]');
  if (!button) return;
  try {
    await requestJson(`/api/admin/reports/${encodeURIComponent(button.dataset.reportId)}`, 'POST', { status: 'closed' });
    await renderAdminOverview();
  } catch (error) {
    showToast(error.message || 'The report could not be updated.');
  }
}

async function openMessagesDialog(conversationId = activeConversationId) {
  try {
    const result = await apiRequest('/api/conversations');
    const list = document.getElementById('conversationList');
    list.innerHTML = result.conversations.length
      ? result.conversations.map(conversation => `<button type="button" class="conversation-item${conversation.id === conversationId ? ' is-active' : ''}" data-conversation-id="${escapeHtml(conversation.id)}">
          <span class="conversation-item__avatar">${escapeHtml(conversation.peer.name.slice(0, 1).toUpperCase())}</span>
          <span class="conversation-item__copy"><strong>${escapeHtml(conversation.peer.name)}</strong><small>${escapeHtml(conversation.product.name)}</small><small>${escapeHtml(new Date(conversation.lastMessageAt).toLocaleDateString())}</small></span>
          ${conversation.unreadCount ? `<span class="conversation-item__unread">${conversation.unreadCount}</span>` : ''}
        </button>`).join('')
      : '<p class="conversation-empty">Your conversations with customers, suppliers and AloSwift support will appear here.</p>';
    if (currentUser.role === 'admin') {
      document.getElementById('adminUnreadCount').textContent = String(result.conversations.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0));
    }
    document.getElementById('startSupportConversation').hidden = currentUser.role === 'admin';
    const dialog = document.getElementById('messagesDialog');
    if (!dialog.open) dialog.showModal();
    activeConversationId = conversationId;
    if (conversationId) await renderConversation(conversationId);
    else renderConversationPlaceholder();
  } catch (error) {
    showToast(error.message || 'Messages could not be loaded.');
  }
}

function renderConversationPlaceholder(message = 'Choose a conversation to read and reply.') {
  document.getElementById('conversationHeading').textContent = 'Your messages';
  document.getElementById('conversationProduct').textContent = '';
  document.getElementById('conversationMessages').innerHTML = `<p class="conversation-empty">${escapeHtml(message)}</p>`;
  document.getElementById('conversationComposer').hidden = true;
}

async function renderConversation(conversationId) {
  try {
    const result = await apiRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
    const { conversation } = result;
    document.getElementById('conversationHeading').textContent = conversation.peer.name;
    document.getElementById('conversationProduct').textContent = conversation.product.name;
    const composer = document.getElementById('conversationComposer');
    composer.hidden = false;
    composer.dataset.conversationId = conversation.id;
    const thread = document.getElementById('conversationMessages');
    thread.innerHTML = result.messages.map(message => `<article class="chat-bubble${message.sender_id === currentUser.id ? ' chat-bubble--own' : ''}${message.legacyEncrypted ? ' chat-bubble--legacy' : ''}">
      <p>${escapeHtml(message.body)}</p><time>${message.legacyEncrypted ? 'Legacy encrypted message · ' : ''}${escapeHtml(new Date(message.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</time>
    </article>`).join('') || '<p class="conversation-empty">Say hello to start the conversation.</p>';
    thread.scrollTop = thread.scrollHeight;
    await refreshConversationList();
  } catch (error) {
    showToast(error.message || 'This conversation could not be loaded.');
  }
}

async function refreshConversationList() {
  const result = await apiRequest('/api/conversations');
  document.getElementById('conversationList').innerHTML = result.conversations.map(conversation => `
    <button type="button" class="conversation-item${conversation.id === activeConversationId ? ' is-active' : ''}" data-conversation-id="${escapeHtml(conversation.id)}">
      <span class="conversation-item__avatar">${escapeHtml(conversation.peer.name.slice(0, 1).toUpperCase())}</span>
      <span class="conversation-item__copy"><strong>${escapeHtml(conversation.peer.name)}</strong><small>${escapeHtml(conversation.product.name)}</small><small>${escapeHtml(new Date(conversation.lastMessageAt).toLocaleDateString())}</small></span>
      ${conversation.unreadCount ? `<span class="conversation-item__unread">${conversation.unreadCount}</span>` : ''}
    </button>`).join('') || '<p class="conversation-empty">Your conversations will appear here.</p>';
}

async function sendConversationMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const textArea = form.elements.namedItem('message');
  const text = String(textArea.value || '').trim();
  if (!text || text.length > 9000 || !activeConversationId) return;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await requestJson(`/api/conversations/${encodeURIComponent(activeConversationId)}/messages`, 'POST', { message: text });
    textArea.value = '';
    await renderConversation(activeConversationId);
  } catch (error) {
    showToast(error.message || 'Your message could not be sent.');
  } finally {
    button.disabled = false;
  }
}

async function submitAdminMessage(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  try {
    const result = await requestJson('/api/conversations', 'POST', { peerId: values.get('recipientId') });
    const message = String(values.get('message') || '').trim();
    form.reset();
    await openMessagesDialog(result.conversationId);
    if (message) {
      const composer = document.getElementById('conversationComposer');
      composer.elements.namedItem('message').value = message;
      composer.requestSubmit();
    }
  } catch (error) {
    showToast(error.message || 'A conversation could not be opened.');
  }
}

function openReportDialog(subjectId) {
  const form = document.getElementById('reportForm');
  form.dataset.subjectId = subjectId;
  form.reset();
  document.getElementById('reportDialog').showModal();
}

async function submitAccountReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  try {
    await requestJson('/api/reports', 'POST', {
      subjectId: form.dataset.subjectId,
      reason: values.get('reason'),
      details: String(values.get('details') || '').trim(),
    });
    document.getElementById('reportDialog').close();
    showToast('Your report was sent privately to the master admin.');
  } catch (error) {
    showToast(error.message || 'Your report could not be submitted.');
  }
}

async function submitSupplierReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  try {
    await requestJson('/api/reports', 'POST', {
      subjectEmail: values.get('subjectEmail'),
      reason: values.get('reason'),
      details: String(values.get('details') || '').trim(),
    });
    form.reset();
    showToast('Your report was sent privately to the master admin.');
  } catch (error) {
    showToast(error.message || 'Your report could not be submitted.');
  }
}

async function submitSupplierReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  try {
    await requestJson('/api/reviews', 'POST', {
      targetId: form.dataset.targetId,
      stars: Number(values.get('stars')),
      comment: String(values.get('comment') || '').trim(),
    });
    await openPublicProfile(form.dataset.targetId);
    showToast('Your review has been published.');
  } catch (error) {
    showToast(error.message || 'Your review could not be submitted.');
  }
}

async function submitCustomerReview(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  try {
    await requestJson('/api/reviews', 'POST', {
      targetEmail: values.get('targetEmail'),
      stars: Number(values.get('stars')),
      comment: String(values.get('comment') || '').trim(),
    });
    form.reset();
    showToast('Your review has been published.');
  } catch (error) {
    showToast(error.message || 'Your review could not be submitted.');
  }
}

function getProducts() {
  return productsCache;
}

function formatPrice(price) {
  return `N$${Number(price).toLocaleString('en-NA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function safeImageUrl(value) {
  if (typeof value === 'string' && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(value)) return value;
  if (typeof value === 'string' && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/]+=*$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function renderCatalog() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;
  const query = document.getElementById('productSearch').value.trim().toLowerCase();
  const category = document.getElementById('categoryFilter').value;
  const sort = document.getElementById('sortProducts').value;
  const products = getProducts().filter(product => {
    const matchesCategory = category === 'all' || product.category === category;
    const matchesQuery = `${product.name} ${product.description} ${product.seller} ${product.category}`.toLowerCase().includes(query);
    return matchesCategory && matchesQuery;
  });

  if (sort === 'price-asc') products.sort((a, b) => Number(a.price) - Number(b.price));
  if (sort === 'price-desc') products.sort((a, b) => Number(b.price) - Number(a.price));
  if (sort === 'name') products.sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('catalogCount').textContent = `${products.length} ${products.length === 1 ? 'piece' : 'pieces'}`;
  document.getElementById('catalogEmpty').hidden = products.length !== 0;
  grid.hidden = products.length === 0;
  grid.innerHTML = products.map(product => {
    const images = getProductImages(product).map(safeImageUrl).filter(Boolean);
    const image = images[0] || '';
    const stock = Number(product.stock) || 0;
    const seller = getAccount(product.ownerId);
    const sellerName = seller && seller.profile ? seller.profile.businessName : product.seller || 'Independent seller';
    return `<article class="product-card" data-track-product="${escapeHtml(product.id)}">
      <div class="product-card__image">${image
        ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">`
        : '<span class="product-placeholder"><i class="bx bx-image" aria-hidden="true"></i></span>'}
        ${images.length > 1 ? `<div class="product-gallery-controls"><button type="button" data-gallery-step="-1" data-product-id="${escapeHtml(product.id)}" aria-label="Previous photo">‹</button><span data-gallery-count>1 / ${images.length}</span><button type="button" data-gallery-step="1" data-product-id="${escapeHtml(product.id)}" aria-label="Next photo">›</button></div>` : ''}
        <span class="product-card__category">${escapeHtml(product.category)}</span>
      </div>
      <div class="product-card__body">
        <div class="product-card__meta"><button type="button" class="product-card__seller" data-view-seller="${escapeHtml(product.ownerId)}">${escapeHtml(sellerName)}</button><span>${stock ? `${stock} available` : 'Sold out'}</span></div>
        <h3 class="product-card__name">${escapeHtml(product.name)}</h3>
        <p class="product-card__desc">${escapeHtml(product.description)}</p>
        <div class="product-card__footer"><strong class="product-card__price">${formatPrice(product.price)}</strong>
          <div class="product-card__actions">
            <button type="button" class="product-add" data-add-to-cart="${escapeHtml(product.id)}" ${stock ? '' : 'disabled'} aria-label="Add ${escapeHtml(product.name)} to bag"><i class="bx bx-shopping-bag" aria-hidden="true"></i><span>Save</span></button>
            <button type="button" class="product-contact" data-contact-seller="${escapeHtml(product.id)}" ${stock ? '' : 'disabled'}><i class="bx bx-message-rounded-dots" aria-hidden="true"></i><span>Ask supplier</span></button>
          </div>
        </div>
      </div>
    </article>`;
  }).join('');
  grid.querySelectorAll('img').forEach(image => {
    image.addEventListener('error', () => {
      const placeholder = document.createElement('span');
      placeholder.className = 'product-placeholder';
      placeholder.innerHTML = '<i class="bx bx-image" aria-hidden="true"></i>';
      image.replaceWith(placeholder);
    }, { once: true });
  });
}

function getProductImages(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  return images.length ? images : product.image ? [product.image] : [];
}

function renderHeader() {
  const user = getCurrentUser();
  document.getElementById('authSignedOut').hidden = Boolean(user);
  document.getElementById('authSignedIn').hidden = !user;
  const name = document.getElementById('accountName');
  const listingTrigger = document.getElementById('listingTrigger');
  if (user) {
    name.textContent = user.role === 'admin' ? 'Master admin' : user.name || 'My profile';
    const avatar = document.getElementById('headerAvatar');
    const image = safeImageUrl(user.profile && user.profile.avatar);
    avatar.hidden = !image;
    avatar.src = image;
    document.getElementById('headerAvatarPlaceholder').hidden = Boolean(image);
    listingTrigger.textContent = user.role === 'admin' ? 'Admin dashboard' : user.role === 'supplier' ? 'My shop' : 'My account';
    document.getElementById('openMessages').hidden = user.role === 'admin';
  }
}

function addToCart(productId) {
  const product = getProducts().find(item => item.id === productId);
  if (!product || Number(product.stock) < 1) {
    showToast('This product is no longer available.');
    renderCatalog();
    return;
  }
  const cart = readJson(STORAGE_KEYS.cart, []);
  const items = Array.isArray(cart) ? cart : [];
  const existing = items.find(item => item.productId === productId);
  if (existing) {
    if (existing.quantity >= Number(product.stock)) {
      showToast('You have reached the available stock for this product.');
      return;
    }
    existing.quantity += 1;
  } else {
    items.push({ productId, quantity: 1 });
  }
  writeJson(STORAGE_KEYS.cart, items);
  renderCart();
  showToast(`${product.name} added to your bag.`);
}

function getCartItems() {
  const items = readJson(STORAGE_KEYS.cart, []);
  return Array.isArray(items)
    ? items.filter(item => item && typeof item.productId === 'string' && Number.isInteger(item.quantity) && item.quantity > 0)
    : [];
}

function renderCart() {
  const cartItems = getCartItems();
  const products = getProducts();
  const resolvedItems = cartItems.map(item => ({
    ...item,
    product: products.find(product => product.id === item.productId),
  })).filter(item => item.product);
  const count = resolvedItems.reduce((sum, item) => sum + item.quantity, 0);
  document.getElementById('cartCount').textContent = String(count);
  document.getElementById('cartHeadingCount').textContent = count ? `(${count})` : '';
  document.getElementById('cartItems').innerHTML = resolvedItems.map(item => {
    const image = safeImageUrl(getProductImages(item.product)[0]);
    const supplier = getAccount(item.product.ownerId);
    const canContact = supplier && profileComplete(supplier);
    return `<article class="cart-item">
      <div class="cart-item__image">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="bx bx-image" aria-hidden="true"></i>'}</div>
      <div class="cart-item__details"><h3>${escapeHtml(item.product.name)}</h3><p>${escapeHtml(supplier && supplier.profile.businessName || item.product.seller || 'Independent seller')}</p>
        <strong>${formatPrice(item.product.price)}</strong>
        <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.product.name)}">
          <button type="button" data-cart-action="decrease" data-product-id="${escapeHtml(item.product.id)}" aria-label="Decrease quantity">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-action="increase" data-product-id="${escapeHtml(item.product.id)}" aria-label="Increase quantity">+</button>
        </div>
        <button type="button" class="text-button cart-item__contact" data-contact-seller="${escapeHtml(item.product.id)}" ${canContact ? '' : 'disabled'}>Ask this supplier</button>
      </div>
      <button class="cart-remove" type="button" data-cart-action="remove" data-product-id="${escapeHtml(item.product.id)}" aria-label="Remove ${escapeHtml(item.product.name)}"><i class="bx bx-trash" aria-hidden="true"></i></button>
    </article>`;
  }).join('');
  const isEmpty = resolvedItems.length === 0;
  document.getElementById('cartEmpty').hidden = !isEmpty;
  document.getElementById('cartSummary').hidden = isEmpty;
}

function handleCartAction(event) {
  const button = event.target.closest('[data-cart-action]');
  if (!button) return;
  const action = button.dataset.cartAction;
  const productId = button.dataset.productId;
  const items = getCartItems();
  const item = items.find(entry => entry.productId === productId);
  const product = getProducts().find(entry => entry.id === productId);
  if (!item) return;
  if (action === 'remove') {
    writeJson(STORAGE_KEYS.cart, items.filter(entry => entry.productId !== productId));
  } else if (action === 'decrease') {
    item.quantity -= 1;
    writeJson(STORAGE_KEYS.cart, items.filter(entry => entry.quantity > 0));
  } else if (action === 'increase' && product && item.quantity < Number(product.stock)) {
    item.quantity += 1;
    writeJson(STORAGE_KEYS.cart, items);
  } else if (action === 'increase') {
    showToast('You have reached the available stock for this product.');
    return;
  }
  renderCart();
}

function openSupplierDashboard() {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (!profileComplete(user)) {
    showToast('Complete your profile before publishing products.');
    openCustomerDashboard();
    return;
  }
  if (user.role !== 'supplier') {
    openCustomerDashboard();
    return;
  }
  setActiveDashboard('supplierDashboard');
  renderSellerProducts();
  renderMyReviews('supplierReviews');
}

function openCustomerDashboard() {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (user.role === 'admin') {
    openAdminDashboard();
    return;
  }
  setActiveDashboard('customerDashboard');
  renderProfileForm();
  renderMyReviews('customerReviews');
}

function closeSupplierDashboard() {
  const dashboard = document.getElementById('supplierDashboard');
  if (!dashboard) return;
  dashboard.hidden = true;
  setActiveDashboard('catalog');
  resetProductForm();
}

function renderSellerProducts() {
  const user = getCurrentUser();
  if (!user) return;
  const products = getProducts().filter(product => product.ownerId === user.id);
  document.getElementById('listingCount').textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  document.getElementById('sellerEmpty').hidden = products.length !== 0;
  document.getElementById('sellerProducts').innerHTML = products.map(product => {
    const image = safeImageUrl(getProductImages(product)[0]);
    return `<article class="seller-product">
      <div class="seller-product__image">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="bx bx-image" aria-hidden="true"></i>'}</div>
      <div class="seller-product__details"><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.category)} · ${Number(product.stock)} in stock</p><strong>${formatPrice(product.price)}</strong><small class="seller-product__views">${Number(product.uniqueViews || 0).toLocaleString()} unique interested visitors</small></div>
      <div class="seller-product__actions"><button class="text-button" type="button" data-seller-action="edit" data-product-id="${escapeHtml(product.id)}">Edit</button><button class="text-button text-button--danger" type="button" data-seller-action="delete" data-product-id="${escapeHtml(product.id)}">Delete</button></div>
    </article>`;
  }).join('');
}

async function saveProduct(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user || user.role !== 'supplier') {
    showToast('A supplier account is required to manage products.');
    return;
  }
  if (!profileComplete(user)) {
    showToast('Complete your public supplier profile before publishing products.');
    openCustomerDashboard();
    return;
  }
  const form = event.currentTarget;
  const values = new FormData(form);
  const name = String(values.get('name') || '').trim();
  const description = String(values.get('description') || '').trim();
  const price = Number(values.get('price'));
  const stock = Number(values.get('stock'));
  const category = String(values.get('category'));
  if (!name || !description || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
    showToast('Add a name, description, valid price and whole-number stock amount.');
    return;
  }
  const products = getProducts();
  const editId = form.dataset.editId;
  const existing = editId && products.find(product => product.id === editId);
  if (editId && (!existing || existing.ownerId !== user.id)) {
    showToast('This listing is no longer available to edit.');
    resetProductForm();
    return;
  }
  const product = {
    name,
    description,
    price,
    stock,
    category,
  };
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    if (stagedProductPhotos.length > 5) throw new Error('Choose up to five photos per listing.');
    const images = stagedProductPhotos.length
      ? await Promise.all(stagedProductPhotos.map(file => compressImage(file)))
      : getProductImages(existing || {});
    product.images = images;
    product.image = images[0] || '';
    const result = await requestJson(
      existing ? `/api/products/${encodeURIComponent(editId)}` : '/api/products',
      existing ? 'PUT' : 'POST',
      { ...product, images },
    );
    productsCache = existing
      ? products.map(item => item.id === editId ? result.product : item)
      : [result.product, ...products];
    resetProductForm();
    renderSellerProducts();
    renderCatalog();
    initLivingDisplay();
    showToast(existing ? 'Your listing has been updated.' : 'Your product is now listed.');
  } catch (error) {
    showToast(error.message || 'Your listing could not be saved. Please try again.');
  } finally {
    submit.disabled = false;
  }
}

async function handleSellerProductAction(event) {
  const button = event.target.closest('[data-seller-action]');
  if (!button) return;
  const user = getCurrentUser();
  const products = getProducts();
  const product = products.find(item => item.id === button.dataset.productId && item.ownerId === user?.id);
  if (!product) {
    showToast('This listing is no longer available.');
    renderSellerProducts();
    return;
  }
  if (button.dataset.sellerAction === 'edit') {
    const form = document.getElementById('productForm');
    form.elements.namedItem('name').value = product.name;
    form.elements.namedItem('description').value = product.description;
    form.elements.namedItem('price').value = product.price;
    form.elements.namedItem('stock').value = product.stock;
    form.elements.namedItem('category').value = product.category;
    stagedProductPhotos = [];
    document.getElementById('productPhotos').value = '';
    updateProductPhotoPreview();
    form.dataset.editId = product.id;
    document.getElementById('productFormTitle').textContent = 'Edit product';
    document.getElementById('productSubmit').textContent = 'Save changes';
    document.getElementById('cancelEdit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (button.dataset.sellerAction === 'delete' && window.confirm(`Remove “${product.name}” from your shop?`)) {
    try {
      await apiRequest(`/api/products/${encodeURIComponent(product.id)}`, { method: 'DELETE' });
      productsCache = products.filter(item => item.id !== product.id);
      writeJson(STORAGE_KEYS.cart, getCartItems().filter(item => item.productId !== product.id));
      resetProductForm();
      renderSellerProducts();
      renderCatalog();
      renderCart();
      initLivingDisplay();
      showToast('Your product has been removed.');
    } catch (error) {
      showToast(error.message || 'Your product could not be removed. Please try again.');
    }
  }
}

function resetProductForm() {
  const form = document.getElementById('productForm');
  if (!form) return;
  form.reset();
  stagedProductPhotos = [];
  document.getElementById('productPhotoPreviews').innerHTML = '';
  document.getElementById('productPhotoLabel').textContent = 'Choose photos or drop them here';
  delete form.dataset.editId;
  document.getElementById('productFormTitle').textContent = 'Add a product';
  document.getElementById('productSubmit').textContent = 'Add product';
  document.getElementById('cancelEdit').hidden = true;
}
