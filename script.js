const STORAGE_KEYS = {
  accounts: 'aloswift_accounts',
  session: 'aloswift_auth',
  products: 'aloswift_products',
  cart: 'aloswift_cart',
  orders: 'aloswift_orders',
};

const starterProducts = [
  {
    id: 'starter-linen-shirt',
    name: 'The linen shirt',
    description: 'An easy, breathable layer made for slow mornings and long afternoons.',
    category: 'Clothing',
    price: 680,
    stock: 5,
    seller: 'Atelier June',
    image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=900&q=85',
    ownerId: '',
  },
  {
    id: 'starter-market-tote',
    name: 'Market day tote',
    description: 'A generously sized everyday carryall in sturdy, natural cotton.',
    category: 'Accessories',
    price: 320,
    stock: 8,
    seller: 'Common Thread',
    image: 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85',
    ownerId: '',
  },
  {
    id: 'starter-ceramic-vase',
    name: 'Sculpted clay vase',
    description: 'Hand-finished stoneware with a soft, organic silhouette.',
    category: 'Home',
    price: 540,
    stock: 3,
    seller: 'Earth & Form',
    image: 'https://images.unsplash.com/photo-1578500494198-246f612d3b3d?auto=format&fit=crop&w=900&q=85',
    ownerId: '',
  },
  {
    id: 'starter-crossbody',
    name: 'Daylight crossbody',
    description: 'A compact, hands-free companion with room for all the essentials.',
    category: 'Accessories',
    price: 890,
    stock: 4,
    seller: 'Marlow Studio',
    image: 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85',
    ownerId: '',
  },
  {
    id: 'starter-knit',
    name: 'Soft knit pullover',
    description: 'A relaxed, beautifully textured knit for cooler evenings.',
    category: 'Clothing',
    price: 1120,
    stock: 2,
    seller: 'Atelier June',
    image: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=900&q=85',
    ownerId: '',
  },
  {
    id: 'starter-ceramic-cup',
    name: 'Morning ritual cup',
    description: 'A tactile, small-batch ceramic cup, finished by hand.',
    category: 'Home',
    price: 260,
    stock: 7,
    seller: 'Earth & Form',
    image: 'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?auto=format&fit=crop&w=900&q=85',
    ownerId: '',
  },
];

document.addEventListener('DOMContentLoaded', () => {
  initFooterMenu();
  initThemeToggle();
  initAuthForms();
  initShop();
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

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Unable to save AloSwift data to "${key}".`, error);
    showToast('Your changes could not be saved. Check the available browser storage and try again.');
    throw error;
  }
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

async function hashPassword(password) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Secure password hashing is unavailable in this browser context. Open the project on localhost to continue.');
  }
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function createId() {
  return window.crypto && typeof window.crypto.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

  if (signupForm) {
    signupForm.addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const name = String(values.get('name') || '').trim();
      const email = String(values.get('email') || '').trim().toLowerCase();
      const password = String(values.get('password') || '');
      const role = String(values.get('role') || 'customer');
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;

      try {
        const accounts = readJson(STORAGE_KEYS.accounts, []);
        if (!Array.isArray(accounts)) throw new Error('Saved accounts are not in a valid format.');
        if (accounts.some(account => account.email === email)) {
          showAuthFeedback(form, 'An account with this email already exists. Please log in instead.', true);
          return;
        }
        const account = {
          id: createId(),
          name,
          email,
          role: role === 'supplier' ? 'supplier' : 'customer',
          passwordHash: await hashPassword(password),
        };
        accounts.push(account);
        writeJson(STORAGE_KEYS.accounts, accounts);
        activateAccount(account);
        window.location.href = 'shop.html';
      } catch (error) {
        console.error('AloSwift account creation failed.', error);
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
      const email = String(values.get('email') || '').trim().toLowerCase();
      const password = String(values.get('password') || '');
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;

      try {
        const accounts = readJson(STORAGE_KEYS.accounts, []);
        if (!Array.isArray(accounts)) throw new Error('Saved accounts are not in a valid format.');
        const account = accounts.find(candidate => candidate.email === email);
        if (!account || account.passwordHash !== await hashPassword(password)) {
          showAuthFeedback(form, 'Email or password is incorrect. Create an account first if you are new here.', true);
          return;
        }
        activateAccount(account);
        window.location.href = 'shop.html';
      } catch (error) {
        console.error('AloSwift login failed.', error);
        showAuthFeedback(form, error.message || 'You could not be signed in. Please try again.', true);
      } finally {
        submit.disabled = false;
      }
    });
  }
}

function activateAccount(account) {
  writeJson(STORAGE_KEYS.session, {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
  });
}

function getCurrentUser() {
  const user = readJson(STORAGE_KEYS.session, null);
  if (!user || typeof user !== 'object' || typeof user.id !== 'string') return null;
  return user;
}

function initShop() {
  const grid = document.getElementById('productGrid');
  if (!grid) return;

  if (localStorage.getItem(STORAGE_KEYS.products) === null) {
    writeJson(STORAGE_KEYS.products, starterProducts);
  }
  renderHeader();
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
    const button = event.target.closest('[data-add-to-cart]');
    if (button) addToCart(button.dataset.addToCart);
  });

  document.getElementById('listingTrigger').addEventListener('click', () => {
    const user = getCurrentUser();
    if (user && user.role === 'supplier') openSupplierDashboard();
    else openCustomerDashboard();
  });
  document.getElementById('supplierCta').addEventListener('click', event => {
    const user = getCurrentUser();
    if (!user) return;
    event.preventDefault();
    if (user.role === 'supplier') openSupplierDashboard();
    else openCustomerDashboard();
  });
  document.getElementById('backToShopFromAccount').addEventListener('click', closeSupplierDashboard);
  document.getElementById('shopFromAccount').addEventListener('click', closeSupplierDashboard);
  document.getElementById('upgradeToSupplier').addEventListener('click', upgradeToSupplier);
  document.getElementById('supplierOrders').addEventListener('click', openCustomerDashboard);
  document.getElementById('backToShop').addEventListener('click', closeSupplierDashboard);
  document.getElementById('productForm').addEventListener('submit', saveProduct);
  document.getElementById('cancelEdit').addEventListener('click', resetProductForm);
  document.getElementById('sellerProducts').addEventListener('click', handleSellerProductAction);
  document.getElementById('logoutTrigger').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEYS.session);
    closeSupplierDashboard();
    renderHeader();
    showToast('You have signed out.');
  });

  document.getElementById('cartTrigger').addEventListener('click', () => document.getElementById('cartDialog').showModal());
  document.getElementById('closeCart').addEventListener('click', () => document.getElementById('cartDialog').close());
  document.getElementById('cartDialog').addEventListener('click', event => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.getElementById('cartItems').addEventListener('click', handleCartAction);
  document.getElementById('checkoutButton').addEventListener('click', placeOrder);
}

function getProducts() {
  const products = readJson(STORAGE_KEYS.products, starterProducts);
  return Array.isArray(products) ? products.filter(product => product && typeof product.id === 'string') : [];
}

function saveProducts(products) {
  writeJson(STORAGE_KEYS.products, products);
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
    const image = safeImageUrl(product.image);
    const stock = Number(product.stock) || 0;
    return `<article class="product-card">
      <div class="product-card__image">${image
        ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy">`
        : '<span class="product-placeholder"><i class="bx bx-image" aria-hidden="true"></i></span>'}
        <span class="product-card__category">${escapeHtml(product.category)}</span>
      </div>
      <div class="product-card__body">
        <div class="product-card__meta"><p class="product-card__seller">${escapeHtml(product.seller || 'AloSwift seller')}</p><span>${stock ? `${stock} available` : 'Sold out'}</span></div>
        <h3 class="product-card__name">${escapeHtml(product.name)}</h3>
        <p class="product-card__desc">${escapeHtml(product.description)}</p>
        <div class="product-card__footer"><strong class="product-card__price">${formatPrice(product.price)}</strong>
          <button type="button" class="product-add" data-add-to-cart="${escapeHtml(product.id)}" ${stock ? '' : 'disabled'} aria-label="Add ${escapeHtml(product.name)} to bag">
            <i class="bx bx-plus" aria-hidden="true"></i><span>${stock ? 'Add to bag' : 'Sold out'}</span>
          </button>
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

function renderHeader() {
  const user = getCurrentUser();
  document.getElementById('authSignedOut').hidden = Boolean(user);
  document.getElementById('authSignedIn').hidden = !user;
  const name = document.getElementById('accountName');
  const listingTrigger = document.getElementById('listingTrigger');
  const cta = document.getElementById('supplierCta');
  if (user) {
    name.textContent = user.name || user.email;
    listingTrigger.textContent = user.role === 'supplier' ? 'My shop' : 'My account';
    cta.textContent = user.role === 'supplier' ? 'Open supplier studio' : 'Open a supplier shop';
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
  const subtotal = resolvedItems.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  document.getElementById('cartCount').textContent = String(count);
  document.getElementById('cartHeadingCount').textContent = count ? `(${count})` : '';
  document.getElementById('cartItems').innerHTML = resolvedItems.map(item => {
    const image = safeImageUrl(item.product.image);
    return `<article class="cart-item">
      <div class="cart-item__image">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="bx bx-image" aria-hidden="true"></i>'}</div>
      <div class="cart-item__details"><h3>${escapeHtml(item.product.name)}</h3><p>${escapeHtml(item.product.seller || 'AloSwift seller')}</p>
        <strong>${formatPrice(item.product.price)}</strong>
        <div class="quantity-control" aria-label="Quantity for ${escapeHtml(item.product.name)}">
          <button type="button" data-cart-action="decrease" data-product-id="${escapeHtml(item.product.id)}" aria-label="Decrease quantity">−</button>
          <span>${item.quantity}</span>
          <button type="button" data-cart-action="increase" data-product-id="${escapeHtml(item.product.id)}" aria-label="Increase quantity">+</button>
        </div>
      </div>
      <button class="cart-remove" type="button" data-cart-action="remove" data-product-id="${escapeHtml(item.product.id)}" aria-label="Remove ${escapeHtml(item.product.name)}"><i class="bx bx-trash" aria-hidden="true"></i></button>
    </article>`;
  }).join('');
  const isEmpty = resolvedItems.length === 0;
  document.getElementById('cartEmpty').hidden = !isEmpty;
  document.getElementById('cartSummary').hidden = isEmpty;
  document.getElementById('cartSubtotal').textContent = formatPrice(subtotal);
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

function placeOrder() {
  const items = getCartItems();
  if (items.length === 0) return;
  const products = getProducts();
  const unavailable = items.find(item => {
    const product = products.find(entry => entry.id === item.productId);
    return !product || Number(product.stock) < item.quantity;
  });
  if (unavailable) {
    showToast('A product in your bag no longer has enough stock. Please update your quantities.');
    renderCart();
    return;
  }
  const orderItems = items.map(item => {
    const product = products.find(entry => entry.id === item.productId);
    product.stock = Number(product.stock) - item.quantity;
    return {
      productId: product.id,
      name: product.name,
      price: Number(product.price),
      quantity: item.quantity,
      seller: product.seller,
    };
  });
  const orders = readJson(STORAGE_KEYS.orders, []);
  if (!Array.isArray(orders)) throw new Error('Saved orders are not in a valid format.');
  orders.unshift({
    id: createId(),
    userId: getCurrentUser() ? getCurrentUser().id : null,
    items: orderItems,
    total: orderItems.reduce((total, item) => total + item.price * item.quantity, 0),
    createdAt: new Date().toISOString(),
    status: 'Placed',
  });
  saveProducts(products);
  writeJson(STORAGE_KEYS.orders, orders);
  writeJson(STORAGE_KEYS.cart, []);
  renderCart();
  renderCatalog();
  if (!document.getElementById('supplierDashboard').hidden) renderSellerProducts();
  if (!document.getElementById('customerDashboard').hidden) renderCustomerOrders();
  document.getElementById('cartDialog').close();
  showToast('Demo order placed. No payment was taken.');
}

function openSupplierDashboard() {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  if (user.role !== 'supplier') {
    openCustomerDashboard();
    return;
  }
  document.getElementById('customerDashboard').hidden = true;
  document.getElementById('supplierDashboard').hidden = false;
  document.getElementById('catalog').hidden = true;
  document.querySelector('.shop-hero').hidden = true;
  document.querySelector('.supplier-callout').hidden = true;
  renderSellerProducts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openCustomerDashboard() {
  const user = getCurrentUser();
  if (!user) {
    window.location.href = 'login.html';
    return;
  }
  document.getElementById('supplierDashboard').hidden = true;
  document.getElementById('customerDashboard').hidden = false;
  document.getElementById('accountSupplierCallout').hidden = user.role === 'supplier';
  document.getElementById('catalog').hidden = true;
  document.querySelector('.shop-hero').hidden = true;
  document.querySelector('.supplier-callout').hidden = true;
  renderCustomerOrders();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeSupplierDashboard() {
  const dashboard = document.getElementById('supplierDashboard');
  if (!dashboard) return;
  dashboard.hidden = true;
  document.getElementById('customerDashboard').hidden = true;
  document.getElementById('accountSupplierCallout').hidden = false;
  document.getElementById('catalog').hidden = false;
  document.querySelector('.shop-hero').hidden = false;
  document.querySelector('.supplier-callout').hidden = false;
  resetProductForm();
}

function renderCustomerOrders() {
  const user = getCurrentUser();
  if (!user) return;
  const orders = readJson(STORAGE_KEYS.orders, []);
  const customerOrders = Array.isArray(orders) ? orders.filter(order => order.userId === user.id) : [];
  document.getElementById('customerOrdersEmpty').hidden = customerOrders.length !== 0;
  document.getElementById('customerOrders').innerHTML = customerOrders.map(order => {
    const date = new Date(order.createdAt).toLocaleDateString('en-NA', { year: 'numeric', month: 'long', day: 'numeric' });
    const lines = order.items.map(item => `<li><span>${escapeHtml(item.name)} <span class="order-quantity">× ${Number(item.quantity)}</span></span><strong>${formatPrice(Number(item.price) * Number(item.quantity))}</strong></li>`).join('');
    return `<article class="order-card">
      <div class="order-card__heading"><div><span>Order ${escapeHtml(order.id.slice(0, 8))}</span><p>${escapeHtml(date)}</p></div><span class="order-status">${escapeHtml(order.status || 'Placed')}</span></div>
      <ul>${lines}</ul><div class="order-card__total"><span>Total</span><strong>${formatPrice(order.total)}</strong></div>
      <p class="order-card__note">Demo order only · Payment and delivery have not been arranged.</p>
    </article>`;
  }).join('');
}

function upgradeToSupplier() {
  const user = getCurrentUser();
  if (!user || user.role === 'supplier') {
    if (user) openSupplierDashboard();
    return;
  }
  const accounts = readJson(STORAGE_KEYS.accounts, []);
  if (!Array.isArray(accounts)) {
    showToast('Your account could not be updated.');
    return;
  }
  const account = accounts.find(candidate => candidate.id === user.id);
  if (!account) {
    showToast('Your account could not be found. Please sign in again.');
    return;
  }
  account.role = 'supplier';
  try {
    writeJson(STORAGE_KEYS.accounts, accounts);
    activateAccount(account);
    renderHeader();
    openSupplierDashboard();
    showToast('Supplier studio unlocked. Start by adding your first product.');
  } catch {
    // writeJson reports storage errors to the shopper.
  }
}

function renderSellerProducts() {
  const user = getCurrentUser();
  if (!user) return;
  const products = getProducts().filter(product => product.ownerId === user.id);
  document.getElementById('listingCount').textContent = `${products.length} ${products.length === 1 ? 'product' : 'products'}`;
  document.getElementById('sellerEmpty').hidden = products.length !== 0;
  document.getElementById('sellerProducts').innerHTML = products.map(product => {
    const image = safeImageUrl(product.image);
    return `<article class="seller-product">
      <div class="seller-product__image">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<i class="bx bx-image" aria-hidden="true"></i>'}</div>
      <div class="seller-product__details"><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.category)} · ${Number(product.stock)} in stock</p><strong>${formatPrice(product.price)}</strong></div>
      <div class="seller-product__actions"><button class="text-button" type="button" data-seller-action="edit" data-product-id="${escapeHtml(product.id)}">Edit</button><button class="text-button text-button--danger" type="button" data-seller-action="delete" data-product-id="${escapeHtml(product.id)}">Delete</button></div>
    </article>`;
  }).join('');
}

function saveProduct(event) {
  event.preventDefault();
  const user = getCurrentUser();
  if (!user || user.role !== 'supplier') {
    showToast('A supplier account is required to manage products.');
    return;
  }
  const form = event.currentTarget;
  const values = new FormData(form);
  const name = String(values.get('name') || '').trim();
  const description = String(values.get('description') || '').trim();
  const price = Number(values.get('price'));
  const stock = Number(values.get('stock'));
  const category = String(values.get('category'));
  const rawImage = String(values.get('image') || '').trim();
  const image = rawImage ? safeImageUrl(rawImage) : '';
  if (rawImage && !image) {
    showToast('Product images must use a valid HTTPS link.');
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
    ...(existing || {}),
    id: existing ? existing.id : createId(),
    name,
    description,
    price,
    stock,
    category,
    image,
    seller: user.name || 'Independent seller',
    ownerId: user.id,
  };
  const nextProducts = existing
    ? products.map(item => item.id === editId ? product : item)
    : [product, ...products];
  try {
    saveProducts(nextProducts);
    resetProductForm();
    renderSellerProducts();
    renderCatalog();
    showToast(existing ? 'Your listing has been updated.' : 'Your product is now listed.');
  } catch {
    // writeJson reports storage errors to the shopper.
  }
}

function handleSellerProductAction(event) {
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
    form.elements.namedItem('image').value = product.image || '';
    form.dataset.editId = product.id;
    document.getElementById('productFormTitle').textContent = 'Edit product';
    document.getElementById('productSubmit').textContent = 'Save changes';
    document.getElementById('cancelEdit').hidden = false;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (button.dataset.sellerAction === 'delete' && window.confirm(`Remove “${product.name}” from your shop?`)) {
    try {
      saveProducts(products.filter(item => item.id !== product.id));
      writeJson(STORAGE_KEYS.cart, getCartItems().filter(item => item.productId !== product.id));
      resetProductForm();
      renderSellerProducts();
      renderCatalog();
      renderCart();
      showToast('Your product has been removed.');
    } catch {
      // writeJson reports storage errors to the shopper.
    }
  }
}

function resetProductForm() {
  const form = document.getElementById('productForm');
  if (!form) return;
  form.reset();
  delete form.dataset.editId;
  document.getElementById('productFormTitle').textContent = 'Add a product';
  document.getElementById('productSubmit').textContent = 'Add product';
  document.getElementById('cancelEdit').hidden = true;
}
