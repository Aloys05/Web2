'use strict';

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const scrypt = promisify(crypto.scrypt);
const root = __dirname;
const dataDirectory = path.resolve(process.env.ALOSWIFT_DATA_DIR || path.join(root, 'data'));
const uploadDirectory = path.join(dataDirectory, 'uploads');
const databasePath = path.join(dataDirectory, 'aloswift.sqlite');
const sessionCookie = 'aloswift_sid';
const sessionLifetime = 30 * 24 * 60 * 60;
const maxRequestBytes = 16 * 1024 * 1024;
const allowedPages = new Set([
  'index.html',
  'shop.html',
  'login.html',
  'signup.html',
  'about.html',
  'contact.html',
  'favicon.png',
  'script.js',
  'style.css',
  'contact.css',
]);

fs.mkdirSync(uploadDirectory, { recursive: true });
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    role TEXT NOT NULL CHECK(role IN ('customer', 'supplier')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    profile_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    banned_until TEXT,
    ban_reason TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL NOT NULL CHECK(price > 0),
    stock INTEGER NOT NULL CHECK(stock >= 0),
    images_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS products_created ON products(created_at DESC);
  CREATE TABLE IF NOT EXISTS admin_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id TEXT NOT NULL,
    user_id TEXT,
    path TEXT NOT NULL,
    visited_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS visits_recent ON visits(visited_at DESC);
  CREATE TABLE IF NOT EXISTS enquiries (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    supplier_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(customer_id, supplier_id)
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    reviewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
    comment TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(reviewer_id, reviewee_id),
    CHECK(reviewer_id <> reviewee_id)
  );
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    subject_name TEXT NOT NULL,
    subject_email TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT,
    CHECK(sender_id <> recipient_id)
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    participant_one TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    participant_two TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id TEXT,
    product_name TEXT NOT NULL DEFAULT 'AloSwift support',
    product_image TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    UNIQUE(participant_one, participant_two, product_id),
    CHECK(participant_one <> participant_two)
  );
  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ciphertext TEXT,
    iv TEXT,
    message_body TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX IF NOT EXISTS conversation_messages_order ON conversation_messages(conversation_id, created_at);
  CREATE TABLE IF NOT EXISTS product_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    visitor_id TEXT NOT NULL,
    user_id TEXT,
    viewed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS product_views_product ON product_views(product_id, viewed_at DESC);
  CREATE INDEX IF NOT EXISTS product_views_distinct ON product_views(product_id, visitor_id);
`);

const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map(column => column.name));
if (!userColumns.has('banned_until')) db.exec('ALTER TABLE users ADD COLUMN banned_until TEXT');
if (!userColumns.has('ban_reason')) db.exec('ALTER TABLE users ADD COLUMN ban_reason TEXT');
const conversationMessageColumns = new Set(db.prepare('PRAGMA table_info(conversation_messages)').all().map(column => column.name));
if (!conversationMessageColumns.has('message_body')) db.exec("ALTER TABLE conversation_messages ADD COLUMN message_body TEXT NOT NULL DEFAULT ''");

const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const getAdminAccount = db.prepare('SELECT user_id FROM admin_accounts WHERE user_id = ?');
const insertUser = db.prepare(`INSERT INTO users
  (id, name, email, role, password_salt, password_hash, profile_json, created_at)
  VALUES (?, ?, ?, ?, ?, ?, '{}', ?)`);
const saveUserProfile = db.prepare('UPDATE users SET name = ?, profile_json = ? WHERE id = ?');
const createSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)');
const removeSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const removeExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
const getSessionUser = db.prepare(`
  SELECT users.* FROM sessions
  JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ? AND sessions.expires_at > ?
`);
const listProducts = db.prepare(`
  SELECT products.*, users.name AS seller_name, users.email AS seller_email,
         users.role AS seller_role, users.profile_json AS seller_profile
  FROM products JOIN users ON users.id = products.owner_id
  WHERE users.role = 'supplier'
    AND (users.banned_until IS NULL OR (users.banned_until <> 'permanent' AND julianday(users.banned_until) <= julianday('now')))
  ORDER BY products.created_at DESC
`);
const listAdminProducts = db.prepare(`
  SELECT products.*, users.name AS seller_name, users.email AS seller_email,
         users.role AS seller_role, users.profile_json AS seller_profile
  FROM products JOIN users ON users.id = products.owner_id
  WHERE users.role = 'supplier'
  ORDER BY products.created_at DESC
`);
const getProduct = db.prepare(`
  SELECT products.*, users.name AS seller_name, users.email AS seller_email,
         users.role AS seller_role, users.profile_json AS seller_profile
  FROM products JOIN users ON users.id = products.owner_id
  WHERE products.id = ?
`);
const listSupplierProducts = db.prepare('SELECT * FROM products WHERE owner_id = ? ORDER BY created_at DESC');
const insertProduct = db.prepare(`
  INSERT INTO products (id, owner_id, name, description, category, price, stock, images_json, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateProduct = db.prepare(`
  UPDATE products SET name = ?, description = ?, category = ?, price = ?, stock = ?, images_json = ?, updated_at = ?
  WHERE id = ? AND owner_id = ?
`);
const deleteProduct = db.prepare('DELETE FROM products WHERE id = ? AND owner_id = ?');
const insertVisit = db.prepare('INSERT INTO visits (visitor_id, user_id, path, visited_at) VALUES (?, ?, ?, ?)');
const insertProductView = db.prepare('INSERT INTO product_views (product_id, visitor_id, user_id, viewed_at) VALUES (?, ?, ?, ?)');
const countProductViews = db.prepare('SELECT COUNT(DISTINCT visitor_id) AS count FROM product_views WHERE product_id = ?');
const insertEnquiry = db.prepare('INSERT OR IGNORE INTO enquiries (id, customer_id, supplier_id, product_id, created_at) VALUES (?, ?, ?, ?, ?)');
const hasEnquiry = db.prepare('SELECT 1 FROM enquiries WHERE customer_id = ? AND supplier_id = ?');
const listReviews = db.prepare(`SELECT reviews.*, users.name AS reviewer_name, users.role AS reviewer_role
  FROM reviews JOIN users ON users.id = reviews.reviewer_id WHERE reviews.reviewee_id = ? ORDER BY reviews.created_at DESC`);
const userById = db.prepare('SELECT id, name, email, role, profile_json, created_at, banned_until, ban_reason FROM users WHERE id = ?');
const updateBan = db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ? AND NOT EXISTS (SELECT 1 FROM admin_accounts WHERE user_id = users.id)');
const removeUser = db.prepare('DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM admin_accounts WHERE user_id = users.id)');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireAdmin(user) {
  if (!user || user.role !== 'admin' || !getAdminAccount.get(user.id)) {
    throw new HttpError(403, 'Master admin access is required.');
  }
}

function json(response, status, payload, extraHeaders = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
}

function cookieValue(header, key) {
  const cookie = (header || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${key}=`));
  return cookie ? decodeURIComponent(cookie.slice(key.length + 1)) : '';
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function safeProfile(raw) {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: getAdminAccount.get(user.id) ? 'admin' : user.role,
    profile: safeProfile(user.profile_json),
    bannedUntil: user.banned_until || null,
  };
}

function adminUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: getAdminAccount.get(user.id) ? 'admin' : user.role,
    profile: safeProfile(user.profile_json),
    createdAt: user.created_at,
    lastVisited: user.last_visited || null,
    bannedUntil: user.banned_until || null,
    banReason: user.ban_reason || '',
  };
}

async function ensureAdminAccount() {
  const email = String(process.env.ALOSWIFT_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ALOSWIFT_ADMIN_PASSWORD || '';
  if (!email && !password) {
    if (!db.prepare('SELECT 1 FROM admin_accounts LIMIT 1').get()) {
      console.warn('Master admin is not configured. Set ALOSWIFT_ADMIN_EMAIL and ALOSWIFT_ADMIN_PASSWORD before starting the server.');
    }
    return;
  }
  if (!email || !password) throw new Error('Set both ALOSWIFT_ADMIN_EMAIL and ALOSWIFT_ADMIN_PASSWORD to configure the master admin.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 128) {
    throw new Error('Configure the master admin with a valid email and a password between 12 and 128 characters.');
  }
  const existing = getUserByEmail.get(email);
  if (existing) {
    if (!getAdminAccount.get(existing.id)) {
      throw new Error('The configured admin email is already in use by a non-admin account.');
    }
    return;
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = await scrypt(password, salt, 64);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  insertUser.run(userId, 'AloSwift Admin', email, 'customer', salt, passwordHash.toString('hex'), now);
  db.prepare('INSERT INTO admin_accounts (user_id, created_at) VALUES (?, ?)').run(userId, now);
  console.log(`Master admin account initialized for ${email}.`);
}

function profileIsComplete(user, profile = safeProfile(user.profile_json)) {
  const required = ['avatar', 'phone', 'town', 'city', 'region', 'country'];
  return required.every(key => typeof profile[key] === 'string' && profile[key].trim())
    && (user.role !== 'supplier' || Boolean(String(profile.businessName || '').trim()));
}

function publicProduct(row) {
  const profile = safeProfile(row.seller_profile);
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.price,
    stock: row.stock,
    images: JSON.parse(row.images_json),
    image: JSON.parse(row.images_json)[0] || '',
    createdAt: row.created_at,
    seller: profile.businessName || row.seller_name,
    supplier: {
      id: row.owner_id,
      name: row.seller_name,
      email: row.seller_email,
      role: row.seller_role,
      profile,
    },
  };
}

function parseCookieHeaders(request, secure) {
  const flags = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secure ? '; Secure' : ''}`;
  return {
    set: `${sessionCookie}=${request}; ${flags}`,
    clear: `${sessionCookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`,
  };
}

function assertSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  const host = request.headers.host;
  if (!host) throw new HttpError(403, 'The request origin could not be verified.');
  const expectedHttp = `http://${host}`;
  const expectedHttps = `https://${host}`;
  if (origin !== expectedHttp && origin !== expectedHttps) {
    throw new HttpError(403, 'Cross-site requests are not allowed.');
  }
}

async function readBody(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) throw new HttpError(413, 'The request is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected an object.');
    return body;
  } catch {
    throw new HttpError(400, 'The request body must be valid JSON.');
  }
}

function validateImageData(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'An uploaded image is not valid.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new HttpError(400, 'Images must be uploaded as JPEG, PNG or WebP files.');
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 6 * 1024 * 1024) throw new HttpError(413, 'Choose an image smaller than 6 MB.');
  return { extension: match[1] === 'jpeg' ? 'jpg' : match[1], buffer };
}

function saveUploadedImage(dataUrl) {
  const { extension, buffer } = validateImageData(dataUrl);
  const filename = `${crypto.randomUUID()}.${extension}`;
  const destination = path.join(uploadDirectory, filename);
  fs.writeFileSync(destination, buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

function deleteUnreferencedImage(imagePath) {
  if (!/^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(imagePath)) return;
  const referenced = db.prepare(`
    SELECT 1 FROM users WHERE profile_json LIKE ?
    UNION ALL
    SELECT 1 FROM products WHERE images_json LIKE ? LIMIT 1
  `).get(`%${imagePath}%`, `%${imagePath}%`);
  if (!referenced) {
    const filename = path.basename(imagePath);
    try {
      fs.unlinkSync(path.join(uploadDirectory, filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function validateProfileInput(body, user, priorProfile) {
  const incoming = body.profile;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    throw new HttpError(400, 'Profile information is required.');
  }
  const name = String(body.name || '').trim();
  const profile = {
    phone: String(incoming.phone || '').trim(),
    town: String(incoming.town || '').trim(),
    city: String(incoming.city || '').trim(),
    region: String(incoming.region || '').trim(),
    country: String(incoming.country || '').trim(),
    businessName: String(incoming.businessName || '').trim(),
    businessId: String(incoming.businessId || '').trim(),
    bio: String(incoming.bio || '').trim(),
    avatar: '',
  };
  if (!name || name.length > 80) throw new HttpError(400, 'Enter a valid name.');
  if (Object.values(profile).slice(0, 5).some(value => !value) || profile.phone.length > 30) {
    throw new HttpError(400, 'Phone, town, city, region and country are required.');
  }
  if (user.role === 'supplier' && !profile.businessName) {
    throw new HttpError(400, 'A public shop or business name is required for suppliers.');
  }
  if (profile.businessName.length > 100 || profile.businessId.length > 80 || profile.bio.length > 280) {
    throw new HttpError(400, 'One or more profile fields are too long.');
  }
  if (typeof incoming.avatar === 'string' && incoming.avatar.startsWith('data:')) {
    profile.avatar = saveUploadedImage(incoming.avatar);
  } else if (typeof incoming.avatar === 'string' && /^\/uploads\/[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(incoming.avatar)) {
    profile.avatar = priorProfile.avatar === incoming.avatar ? incoming.avatar : '';
  }
  if (!profile.avatar) throw new HttpError(400, 'A profile picture is required.');
  return { name, profile };
}

function normalizeProduct(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const category = typeof body.category === 'string' ? body.category : '';
  const price = Number(body.price);
  const stock = Number(body.stock);
  if (!name || name.length > 70) throw new HttpError(400, 'Enter a product name of up to 70 characters.');
  if (!description || description.length > 240) throw new HttpError(400, 'Enter a description of up to 240 characters.');
  if (!['Clothing', 'Accessories', 'Home'].includes(category)) throw new HttpError(400, 'Choose a valid product category.');
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) throw new HttpError(400, 'Enter a valid product price.');
  if (!Number.isInteger(stock) || stock < 0 || stock > 1000000) throw new HttpError(400, 'Enter a valid whole-number stock amount.');
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 5)) {
    throw new HttpError(400, 'Choose up to five product photos.');
  }
  return { name, description, category, price, stock, images: body.images || [] };
}

async function createServer() {
  await ensureAdminAccount();

  function requestSession(request) {
    const token = cookieValue(request.headers.cookie, sessionCookie);
    if (!token || token.length > 128) return null;
    const now = Math.floor(Date.now() / 1000);
    removeExpiredSessions.run(now);
    const user = getSessionUser.get(tokenHash(token), now);
    if (user && getAdminAccount.get(user.id)) user.role = 'admin';
    return user || null;
  }

  async function handleApi(request, response, url) {
    const secure = request.socket.encrypted || process.env.NODE_ENV === 'production';
    const cookieHeaders = parseCookieHeaders('', secure);
    const sessionUser = requestSession(request);
    const { pathname } = url;

    if (request.method === 'GET' && pathname === '/api/session') {
      return json(response, 200, { user: sessionUser ? publicUser(sessionUser) : null });
    }

    if (request.method === 'GET' && pathname === '/api/site-config') {
      const adminId = db.prepare('SELECT user_id FROM admin_accounts LIMIT 1').get();
      const adminEmail = db.prepare(`SELECT users.email FROM users JOIN admin_accounts ON users.id = admin_accounts.user_id LIMIT 1`).get();
      return json(response, 200, {
        adminEmail: adminEmail ? adminEmail.email : '',
        adminId: adminId ? adminId.user_id : '',
      });
    }

    if (request.method === 'POST' && (pathname === '/api/auth/signup' || pathname === '/api/auth/login')) {
      assertSameOrigin(request);
      const body = await readBody(request);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) {
        throw new HttpError(400, 'Enter a valid email and a password between 8 and 128 characters.');
      }
      if (pathname.endsWith('/signup') && process.env.ALOSWIFT_ADMIN_EMAIL
        && email === process.env.ALOSWIFT_ADMIN_EMAIL.trim().toLowerCase()) {
        throw new HttpError(409, 'This email is reserved for the master admin.');
      }
      let user;
      if (pathname.endsWith('/signup')) {
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const role = body.role === 'supplier' ? 'supplier' : body.role === 'customer' ? 'customer' : '';
        if (!name || name.length > 80 || !role) throw new HttpError(400, 'Enter your name and choose an account type.');
        if (getUserByEmail.get(email)) throw new HttpError(409, 'An account with this email already exists.');
        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = await scrypt(password, salt, 64);
        user = {
          id: crypto.randomUUID(),
          name,
          email,
          role,
          password_salt: salt,
          password_hash: passwordHash.toString('hex'),
          profile_json: '{}',
        };
        try {
          insertUser.run(user.id, user.name, user.email, user.role, salt, user.password_hash, new Date().toISOString());
        } catch (error) {
          if (error.code === 'ERR_SQLITE_ERROR') throw new HttpError(409, 'An account with this email already exists.');
          throw error;
        }
      } else {
        user = getUserByEmail.get(email);
        if (!user) throw new HttpError(401, 'Email or password is incorrect.');
        const submittedHash = await scrypt(password, user.password_salt, 64);
        const savedHash = Buffer.from(user.password_hash, 'hex');
        if (savedHash.length !== submittedHash.length || !crypto.timingSafeEqual(savedHash, submittedHash)) {
          throw new HttpError(401, 'Email or password is incorrect.');
        }
        if (user.banned_until && (user.banned_until === 'permanent' || Date.parse(user.banned_until) > Date.now())) {
          throw new HttpError(403, `This account is banned${user.ban_reason ? `: ${user.ban_reason}` : '.'}`);
        }
      }
      const token = crypto.randomBytes(32).toString('base64url');
      createSession.run(tokenHash(token), user.id, Math.floor(Date.now() / 1000) + sessionLifetime);
      const headers = { 'Set-Cookie': `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionLifetime}${secure ? '; Secure' : ''}` };
      return json(response, pathname.endsWith('/signup') ? 201 : 200, { user: publicUser(user) }, headers);
    }

    if (request.method === 'POST' && pathname === '/api/auth/logout') {
      assertSameOrigin(request);
      const token = cookieValue(request.headers.cookie, sessionCookie);
      if (token) removeSession.run(tokenHash(token));
      return json(response, 200, { ok: true }, { 'Set-Cookie': cookieHeaders.clear });
    }

    const productViewRoute = pathname.match(/^\/api\/products\/([0-9a-f-]+)\/view$/i);
    if (request.method === 'POST' && productViewRoute) {
      assertSameOrigin(request);
      const visitorId = cookieValue(request.headers.cookie, 'aloswift_vid');
      const product = getProduct.get(productViewRoute[1]);
      if (!product) throw new HttpError(404, 'That product could not be found.');
      insertProductView.run(product.id, /^[a-f0-9-]{36}$/i.test(visitorId) ? visitorId : crypto.randomUUID(),
        sessionUser ? sessionUser.id : null, new Date().toISOString());
      return json(response, 204, {});
    }

    if (pathname.startsWith('/api/') && !sessionUser
      && !(request.method === 'GET' && (pathname === '/api/products' || /^\/api\/users\/[0-9a-f-]+\/reviews$/i.test(pathname)))
      && !(request.method === 'POST' && productViewRoute)) {
      throw new HttpError(401, 'Please sign in to continue.');
    }
    if (sessionUser && sessionUser.role !== 'admin' && sessionUser.banned_until
      && (sessionUser.banned_until === 'permanent' || Date.parse(sessionUser.banned_until) > Date.now())
      && !(request.method === 'GET' && pathname === '/api/products')) {
      throw new HttpError(403, `This account is banned${sessionUser.ban_reason ? `: ${sessionUser.ban_reason}` : '.'}`);
    }

    if (request.method === 'GET' && pathname === '/api/admin/overview') {
      requireAdmin(sessionUser);
      const users = db.prepare(`SELECT users.id, users.name, users.email, users.role, users.profile_json,
          users.created_at, users.banned_until, users.ban_reason,
          (SELECT MAX(visited_at) FROM visits WHERE visits.user_id = users.id) AS last_visited
        FROM users ORDER BY users.created_at DESC`).all().map(adminUser);
      const products = listAdminProducts.all().map(row => ({
        ...publicProduct(row),
        uniqueViews: countProductViews.get(row.id).count,
      }));
      const reports = db.prepare(`SELECT reports.*, users.name AS reporter_name, users.email AS reporter_email
        FROM reports LEFT JOIN users ON users.id = reports.reporter_id
        ORDER BY reports.created_at DESC`).all().map(report => ({
          id: report.id,
          reporterId: report.reporter_id,
          reporterName: report.reporter_name || 'Deleted account',
          reporterEmail: report.reporter_email || '',
          subjectId: report.subject_id,
          subjectName: report.subject_name,
          subjectEmail: report.subject_email,
          reason: report.reason,
          details: report.details,
          status: report.status,
          createdAt: report.created_at,
        }));
      const reviews = db.prepare(`SELECT reviews.*, reviewer.name AS reviewer_name, reviewer.role AS reviewer_role,
          reviewee.name AS reviewee_name, reviewee.role AS reviewee_role
        FROM reviews JOIN users reviewer ON reviewer.id = reviews.reviewer_id
        JOIN users reviewee ON reviewee.id = reviews.reviewee_id
        ORDER BY reviews.created_at DESC`).all();
      const visits = db.prepare(`SELECT date(visited_at) AS visit_date,
          COUNT(DISTINCT visitor_id) AS visitors, COUNT(*) AS page_visits
        FROM visits GROUP BY date(visited_at) ORDER BY visit_date DESC LIMIT 90`).all();
      const visitorCount = db.prepare('SELECT COUNT(DISTINCT visitor_id) AS count FROM visits').get().count;
      const accountCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE id NOT IN (SELECT user_id FROM admin_accounts)').get().count;
      const messageCount = db.prepare(`SELECT
        (SELECT COUNT(*) FROM messages WHERE recipient_id = ? AND read_at IS NULL) +
        (SELECT COUNT(*) FROM conversation_messages WHERE sender_id <> ? AND read_at IS NULL
          AND conversation_id IN (SELECT id FROM conversations WHERE participant_one = ? OR participant_two = ?)) AS count`)
        .get(sessionUser.id, sessionUser.id, sessionUser.id, sessionUser.id).count;
      return json(response, 200, {
        visitorCount,
        accountCount,
        productCount: listProducts.all().filter(row => profileIsComplete({ role: row.seller_role }, safeProfile(row.seller_profile))).length,
        openReportCount: reports.filter(report => report.status === 'open').length,
        unreadMessageCount: messageCount,
        users,
        products,
        reports,
        reviews,
        visits: visits.map(visit => ({ date: visit.visit_date, visitors: visit.visitors, pageVisits: visit.page_visits })),
      });
    }

    if (request.method === 'POST' && pathname === '/api/admin/messages') {
      assertSameOrigin(request);
      requireAdmin(sessionUser);
      throw new HttpError(410, 'This legacy messaging endpoint is retired. Use a conversation instead.');
    }

    const adminUserRoute = pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)(?:\/(ban))?$/i);
    if (adminUserRoute && request.method === 'POST' && adminUserRoute[2] === 'ban') {
      assertSameOrigin(request);
      requireAdmin(sessionUser);
      const targetId = adminUserRoute[1];
      const target = userById.get(targetId);
      if (!target || getAdminAccount.get(targetId)) throw new HttpError(404, 'That account could not be found.');
      const body = await readBody(request);
      const durationHours = body.durationHours;
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (durationHours === -1) {
        updateBan.run(null, null, targetId);
        return json(response, 200, { ok: true, bannedUntil: null });
      }
      if (!Number.isInteger(durationHours) || durationHours < 0 || durationHours > 8760) {
        throw new HttpError(400, 'Choose a ban duration from 1 hour to 365 days, or 0 for a permanent ban.');
      }
      if (!reason || reason.length > 500) throw new HttpError(400, 'Add a reason of up to 500 characters.');
      const bannedUntil = durationHours === 0 ? 'permanent' : new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
      updateBan.run(bannedUntil, reason, targetId);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      return json(response, 200, { ok: true, bannedUntil });
    }

    if (adminUserRoute && request.method === 'DELETE' && !adminUserRoute[2]) {
      assertSameOrigin(request);
      requireAdmin(sessionUser);
      const targetId = adminUserRoute[1];
      if (targetId === sessionUser.id) throw new HttpError(400, 'The master admin account cannot delete itself.');
      const target = userById.get(targetId);
      if (!target || getAdminAccount.get(targetId)) throw new HttpError(404, 'That account could not be found.');
      const images = target.role === 'supplier'
        ? db.prepare('SELECT images_json FROM products WHERE owner_id = ?').all(targetId).flatMap(row => JSON.parse(row.images_json))
        : [];
      if (safeProfile(target.profile_json).avatar) images.push(safeProfile(target.profile_json).avatar);
      if (removeUser.run(targetId).changes !== 1) throw new HttpError(404, 'That account could not be deleted.');
      for (const image of images) deleteUnreferencedImage(image);
      return json(response, 200, { ok: true });
    }

    const reportRoute = pathname.match(/^\/api\/admin\/reports\/([0-9a-f-]+)$/i);
    if (reportRoute && request.method === 'POST') {
      assertSameOrigin(request);
      requireAdmin(sessionUser);
      const body = await readBody(request);
      const status = body.status === 'closed' ? 'closed' : 'open';
      const result = db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportRoute[1]);
      if (!result.changes) throw new HttpError(404, 'That report could not be found.');
      return json(response, 200, { ok: true });
    }

    if (request.method === 'GET' && pathname === '/api/messages') {
      const messages = db.prepare(`SELECT messages.*, sender.name AS sender_name, sender.email AS sender_email,
          recipient.name AS recipient_name, recipient.email AS recipient_email
        FROM messages JOIN users sender ON sender.id = messages.sender_id
        JOIN users recipient ON recipient.id = messages.recipient_id
        WHERE messages.recipient_id = ? OR messages.sender_id = ?
        ORDER BY messages.created_at DESC LIMIT 200`).all(sessionUser.id, sessionUser.id);
      db.prepare('UPDATE messages SET read_at = ? WHERE recipient_id = ? AND read_at IS NULL')
        .run(new Date().toISOString(), sessionUser.id);
      return json(response, 200, { messages: messages.map(message => ({
        id: message.id,
        senderId: message.sender_id,
        senderName: message.sender_name,
        senderEmail: message.sender_email,
        recipientId: message.recipient_id,
        recipientName: message.recipient_name,
        recipientEmail: message.recipient_email,
        body: message.body,
        createdAt: message.created_at,
        readAt: message.read_at,
      })) });
    }

    if (request.method === 'GET' && pathname === '/api/my-reviews') {
      return json(response, 200, { reviews: listReviews.all(sessionUser.id) });
    }

    if (request.method === 'POST' && pathname === '/api/messages') {
      assertSameOrigin(request);
      throw new HttpError(410, 'This legacy messaging endpoint is retired. Use a conversation instead.');
    }

    if (request.method === 'POST' && pathname === '/api/reports') {
      assertSameOrigin(request);
      const body = await readBody(request);
      const subjectId = String(body.subjectId || '');
      const subjectEmail = typeof body.subjectEmail === 'string' ? body.subjectEmail.trim() : '';
      const subject = subjectId ? userById.get(subjectId) : (subjectEmail ? getUserByEmail.get(subjectEmail) : null);
      const reason = typeof body.reason === 'string' ? body.reason : '';
      const details = typeof body.details === 'string' ? body.details.trim() : '';
      if (!subject || subject.id === sessionUser.id || getAdminAccount.get(subject.id)) throw new HttpError(404, 'Choose a valid account to report.');
      if (!['scam', 'imposter', 'misleading', 'other'].includes(reason)) throw new HttpError(400, 'Choose a report reason.');
      if (!details || details.length > 2000) throw new HttpError(400, 'Describe the concern in up to 2,000 characters.');
      db.prepare(`INSERT INTO reports (id, reporter_id, subject_id, subject_name, subject_email, reason, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(), sessionUser.id, subject.id, subject.name, subject.email, reason, details, new Date().toISOString());
      return json(response, 201, { ok: true });
    }

    if (request.method === 'POST' && pathname === '/api/enquiries') {
      assertSameOrigin(request);
      if (sessionUser.role !== 'customer') throw new HttpError(403, 'Only customers can send product enquiries.');
      const body = await readBody(request);
      const product = getProduct.get(String(body.productId || ''));
      if (!product || product.owner_id === sessionUser.id || product.seller_role !== 'supplier') {
        throw new HttpError(404, 'That product or supplier could not be found.');
      }
      if (!profileIsComplete(sessionUser) || !profileIsComplete({ role: product.seller_role }, safeProfile(product.seller_profile))) {
        throw new HttpError(403, 'Both accounts must have complete profiles before an enquiry can be recorded.');
      }
      const supplier = userById.get(product.owner_id);
      if (supplier.banned_until
        && (supplier.banned_until === 'permanent' || Date.parse(supplier.banned_until) > Date.now())) {
        throw new HttpError(403, 'This supplier cannot receive enquiries right now.');
      }
      insertEnquiry.run(crypto.randomUUID(), sessionUser.id, product.owner_id, product.id, new Date().toISOString());
      return json(response, 201, { ok: true });
    }

    if (request.method === 'POST' && pathname === '/api/reviews') {
      assertSameOrigin(request);
      const body = await readBody(request);
      if (sessionUser.role === 'admin') throw new HttpError(403, 'The master admin account cannot post reviews.');
      const targetId = String(body.targetId || '');
      const targetEmail = typeof body.targetEmail === 'string' ? body.targetEmail.trim() : '';
      const target = targetId ? userById.get(targetId) : (targetEmail ? getUserByEmail.get(targetEmail) : null);
      const revieweeId = target ? target.id : targetId;
      const stars = Number(body.stars);
      const comment = typeof body.comment === 'string' ? body.comment.trim() : '';
      if (!target || revieweeId === sessionUser.id || getAdminAccount.get(revieweeId)) throw new HttpError(404, 'Choose a valid account to review.');
      if (sessionUser.role === target.role || !hasEnquiry.get(
        sessionUser.role === 'customer' ? sessionUser.id : revieweeId,
        sessionUser.role === 'supplier' ? sessionUser.id : revieweeId,
      )) throw new HttpError(403, 'Reviews are available to customers and suppliers who have exchanged an enquiry.');
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'Choose a rating from 1 to 5 stars.');
      if (!comment || comment.length > 1000) throw new HttpError(400, 'Add a comment of up to 1,000 characters.');
      try {
        db.prepare('INSERT INTO reviews (id, reviewer_id, reviewee_id, stars, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(crypto.randomUUID(), sessionUser.id, revieweeId, stars, comment, new Date().toISOString());
      } catch (error) {
        if (String(error.message).includes('UNIQUE constraint failed')) throw new HttpError(409, 'You have already reviewed this account.');
        throw error;
      }
      return json(response, 201, { ok: true });
    }

    const userReviewsRoute = pathname.match(/^\/api\/users\/([0-9a-f-]+)\/reviews$/i);
    if (userReviewsRoute && request.method === 'GET') {
      const reviews = listReviews.all(userReviewsRoute[1]);
      const aggregate = db.prepare('SELECT COUNT(*) AS count, AVG(stars) AS average FROM reviews WHERE reviewee_id = ?').get(userReviewsRoute[1]);
      return json(response, 200, { count: aggregate.count, average: aggregate.average || 0, reviews });
    }

    if (request.method === 'GET' && pathname === '/api/products') {
      const products = listProducts.all().filter(row => profileIsComplete({ role: row.seller_role }, safeProfile(row.seller_profile)));
      return json(response, 200, { products: products.map(publicProduct) });
    }

    if (request.method === 'POST' && pathname === '/api/conversations') {
      assertSameOrigin(request);
      const body = await readBody(request);
      let product = null;
      let peerId = String(body.peerId || '');
      let productId = null;
      if (body.productId) {
        if (sessionUser.role !== 'customer') throw new HttpError(403, 'Only customers can start a product enquiry.');
        product = getProduct.get(String(body.productId));
        if (!product || product.owner_id === sessionUser.id || product.seller_role !== 'supplier') {
          throw new HttpError(404, 'That product or supplier could not be found.');
        }
        if (!profileIsComplete(sessionUser) || !profileIsComplete({ role: product.seller_role }, safeProfile(product.seller_profile))) {
          throw new HttpError(403, 'Both accounts must have complete profiles before an enquiry.');
        }
        const supplier = userById.get(product.owner_id);
        if (supplier.banned_until && (supplier.banned_until === 'permanent' || Date.parse(supplier.banned_until) > Date.now())) {
          throw new HttpError(403, 'This supplier cannot receive enquiries right now.');
        }
        peerId = product.owner_id;
        productId = product.id;
      } else if (!peerId && sessionUser.role !== 'admin') {
        peerId = (db.prepare('SELECT user_id FROM admin_accounts LIMIT 1').get() || {}).user_id || '';
      }
      const peer = peerId && userById.get(peerId);
      if (!peer || peerId === sessionUser.id || (sessionUser.role === 'admin' && getAdminAccount.get(peerId))) {
        throw new HttpError(404, 'The conversation participant could not be found.');
      }
      const peerIsAdmin = Boolean(getAdminAccount.get(peerId));
      if (!product && sessionUser.role !== 'admin' && !peerIsAdmin) {
        if (peer.banned_until && (peer.banned_until === 'permanent' || Date.parse(peer.banned_until) > Date.now())) {
          throw new HttpError(403, 'This account cannot receive conversations right now.');
        }
        const isMarketplacePair = (sessionUser.role === 'customer' && peer.role === 'supplier')
          || (sessionUser.role === 'supplier' && peer.role === 'customer');
        if (!isMarketplacePair) throw new HttpError(403, 'Customer and supplier conversations are only available between marketplace participants.');
        if (!profileIsComplete(sessionUser) || !profileIsComplete(peer)) {
          throw new HttpError(403, 'Both accounts must have complete profiles before starting a conversation.');
        }
      }
      if (product) insertEnquiry.run(crypto.randomUUID(), sessionUser.id, product.owner_id, product.id, new Date().toISOString());
      const [one, two] = [sessionUser.id, peerId].sort();
      let conversation = productId
        ? db.prepare('SELECT * FROM conversations WHERE participant_one = ? AND participant_two = ? AND product_id = ?').get(one, two, productId)
        : db.prepare('SELECT * FROM conversations WHERE participant_one = ? AND participant_two = ? AND product_id IS NULL').get(one, two);
      if (!conversation) {
        const conversationId = crypto.randomUUID();
        db.prepare(`INSERT INTO conversations
          (id, participant_one, participant_two, product_id, product_name, product_image, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          conversationId, one, two, productId,
          product ? product.name : 'AloSwift support',
          product ? (JSON.parse(product.images_json)[0] || '') : '',
          new Date().toISOString(),
        );
        conversation = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId);
      }
      return json(response, 201, { conversationId: conversation.id });
    }

    if (request.method === 'GET' && pathname === '/api/conversations') {
      const rows = db.prepare(`SELECT conversations.*,
          CASE WHEN conversations.participant_one = ? THEN conversations.participant_two ELSE conversations.participant_one END AS peer_id,
          peer.name AS peer_name, peer.email AS peer_email, peer.role AS peer_role, peer.profile_json AS peer_profile,
          (SELECT COUNT(*) FROM conversation_messages unread
            WHERE unread.conversation_id = conversations.id AND unread.sender_id <> ? AND unread.read_at IS NULL) AS unread_count,
          (SELECT created_at FROM conversation_messages recent WHERE recent.conversation_id = conversations.id
            ORDER BY recent.created_at DESC LIMIT 1) AS last_message_at
        FROM conversations
        JOIN users peer ON peer.id = CASE WHEN conversations.participant_one = ? THEN conversations.participant_two ELSE conversations.participant_one END
        WHERE conversations.participant_one = ? OR conversations.participant_two = ?
        ORDER BY COALESCE(last_message_at, conversations.created_at) DESC`).all(
        sessionUser.id, sessionUser.id, sessionUser.id, sessionUser.id, sessionUser.id,
      );
      return json(response, 200, { conversations: rows.map(row => ({
        id: row.id,
        peer: { id: row.peer_id, name: row.peer_name, email: row.peer_email, role: getAdminAccount.get(row.peer_id) ? 'admin' : row.peer_role, profile: safeProfile(row.peer_profile) },
        product: { id: row.product_id, name: row.product_name, image: row.product_image },
        unreadCount: row.unread_count,
        lastMessageAt: row.last_message_at || row.created_at,
      })) });
    }

    const conversationRoute = pathname.match(/^\/api\/conversations\/([0-9a-f-]+)(?:\/messages)?$/i);
    if (conversationRoute && request.method === 'GET') {
      const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND (participant_one = ? OR participant_two = ?)')
        .get(conversationRoute[1], sessionUser.id, sessionUser.id);
      if (!conversation) throw new HttpError(404, 'That conversation could not be found.');
      const peerId = conversation.participant_one === sessionUser.id ? conversation.participant_two : conversation.participant_one;
      const peer = userById.get(peerId);
      if (!peer) throw new HttpError(404, 'That conversation participant could not be found.');
      const messages = db.prepare(`SELECT id, sender_id, message_body, ciphertext, created_at, read_at
        FROM conversation_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 500`).all(conversation.id);
      db.prepare(`UPDATE conversation_messages SET read_at = ?
        WHERE conversation_id = ? AND sender_id <> ? AND read_at IS NULL`)
        .run(new Date().toISOString(), conversation.id, sessionUser.id);
      return json(response, 200, {
        conversation: {
          id: conversation.id,
          peer: { id: peer.id, name: peer.name, email: peer.email, role: getAdminAccount.get(peer.id) ? 'admin' : peer.role, profile: safeProfile(peer.profile_json) },
          product: { id: conversation.product_id, name: conversation.product_name, image: conversation.product_image },
        },
        messages: messages.map(message => ({
          id: message.id,
          sender_id: message.sender_id,
          body: message.message_body || 'This older encrypted message cannot be displayed in standard chat.',
          legacyEncrypted: !message.message_body,
          created_at: message.created_at,
          read_at: message.read_at,
        })),
      });
    }

    const conversationMessagesRoute = pathname.match(/^\/api\/conversations\/([0-9a-f-]+)\/messages$/i);
    if (conversationMessagesRoute && request.method === 'POST') {
      assertSameOrigin(request);
      const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND (participant_one = ? OR participant_two = ?)')
        .get(conversationMessagesRoute[1], sessionUser.id, sessionUser.id);
      if (!conversation) throw new HttpError(404, 'That conversation could not be found.');
      const peerId = conversation.participant_one === sessionUser.id ? conversation.participant_two : conversation.participant_one;
      const peer = userById.get(peerId);
      if (!peer) throw new HttpError(404, 'That conversation participant could not be found.');
      const body = await readBody(request);
      const messageBody = typeof body.message === 'string' ? body.message.trim() : '';
      if (!messageBody || messageBody.length > 9000) {
        throw new HttpError(400, 'Enter a message of up to 9,000 characters.');
      }
      const messageId = crypto.randomUUID();
      const sentAt = new Date().toISOString();
      db.prepare(`INSERT INTO conversation_messages
        (id, conversation_id, sender_id, ciphertext, iv, message_body, created_at)
        VALUES (?, ?, ?, '', '', ?, ?)`).run(messageId, conversation.id, sessionUser.id, messageBody, sentAt);
      return json(response, 201, { message: { id: messageId, senderId: sessionUser.id, body: messageBody, createdAt: sentAt } });
    }

    if (request.method === 'PUT' && pathname === '/api/profile') {
      assertSameOrigin(request);
      const body = await readBody(request);
      const oldProfile = safeProfile(sessionUser.profile_json);
      const { name, profile } = validateProfileInput(body, sessionUser, oldProfile);
      saveUserProfile.run(name, JSON.stringify(profile), sessionUser.id);
      const updated = getUserById.get(sessionUser.id);
      if (oldProfile.avatar && oldProfile.avatar !== profile.avatar) deleteUnreferencedImage(oldProfile.avatar);
      return json(response, 200, { user: publicUser(updated) });
    }

    if (pathname === '/api/supplier/products' && request.method === 'GET' && sessionUser.role === 'supplier') {
      const rows = listSupplierProducts.all(sessionUser.id);
      return json(response, 200, { products: rows.map(row => ({
        id: row.id,
        ownerId: row.owner_id,
        name: row.name,
        description: row.description,
        category: row.category,
        price: row.price,
        stock: row.stock,
        images: JSON.parse(row.images_json),
        image: JSON.parse(row.images_json)[0] || '',
        uniqueViews: countProductViews.get(row.id).count,
        seller: safeProfile(sessionUser.profile_json).businessName || sessionUser.name,
      })) });
    }

    if (pathname === '/api/products' && request.method === 'POST') {
      assertSameOrigin(request);
      if (sessionUser.role !== 'supplier') throw new HttpError(403, 'A supplier account is required to list products.');
      if (!profileIsComplete(sessionUser)) throw new HttpError(403, 'Complete your supplier profile before publishing products.');
      const body = await readBody(request);
      const product = normalizeProduct(body);
      const files = [];
      try {
        for (const image of product.images) files.push(saveUploadedImage(image));
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        insertProduct.run(id, sessionUser.id, product.name, product.description, product.category, product.price, product.stock, JSON.stringify(files), now, now);
        return json(response, 201, { product: publicProduct(getProduct.get(id)) });
      } catch (error) {
        for (const file of files) deleteUnreferencedImage(file);
        throw error;
      }
    }

    const productRoute = pathname.match(/^\/api\/products\/([0-9a-f-]+)$/i);
    if (productRoute && request.method === 'PUT') {
      assertSameOrigin(request);
      if (sessionUser.role !== 'supplier') throw new HttpError(403, 'A supplier account is required to edit listings.');
      const previous = getProduct.get(productRoute[1]);
      if (!previous || previous.owner_id !== sessionUser.id) throw new HttpError(404, 'That listing could not be found.');
      const body = await readBody(request);
      const product = normalizeProduct(body);
      const previousImages = JSON.parse(previous.images_json);
      const images = [];
      const uploaded = [];
      try {
        for (const image of product.images) {
          if (typeof image === 'string' && image.startsWith('data:')) {
            const saved = saveUploadedImage(image);
            images.push(saved);
            uploaded.push(saved);
          } else if (typeof image === 'string' && previousImages.includes(image)) {
            images.push(image);
          } else {
            throw new HttpError(400, 'A product photo is not valid.');
          }
        }
        updateProduct.run(product.name, product.description, product.category, product.price, product.stock, JSON.stringify(images), new Date().toISOString(), previous.id, sessionUser.id);
        for (const image of previousImages) if (!images.includes(image)) deleteUnreferencedImage(image);
        return json(response, 200, { product: publicProduct(getProduct.get(previous.id)) });
      } catch (error) {
        for (const image of uploaded) deleteUnreferencedImage(image);
        throw error;
      }
    }

    if (productRoute && request.method === 'DELETE') {
      assertSameOrigin(request);
      if (sessionUser.role !== 'supplier') throw new HttpError(403, 'A supplier account is required to remove listings.');
      const previous = getProduct.get(productRoute[1]);
      if (!previous || previous.owner_id !== sessionUser.id) throw new HttpError(404, 'That listing could not be found.');
      deleteProduct.run(previous.id, sessionUser.id);
      for (const image of JSON.parse(previous.images_json)) deleteUnreferencedImage(image);
      return json(response, 200, { ok: true });
    }

    throw new HttpError(404, 'This API route does not exist.');
  }

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(request, response, url);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'This method is not allowed.');
      if (url.pathname.startsWith('/uploads/')) {
        const filename = path.basename(url.pathname);
        if (filename !== url.pathname.slice('/uploads/'.length) || !/^[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(filename)) {
          throw new HttpError(404, 'Image not found.');
        }
        const location = path.join(uploadDirectory, filename);
        if (!fs.existsSync(location)) throw new HttpError(404, 'Image not found.');
        const type = path.extname(filename).toLowerCase() === '.png' ? 'image/png'
          : path.extname(filename).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg';
        response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
        fs.createReadStream(location).pipe(response);
        return;
      }
      const filename = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      if (!allowedPages.has(filename)) throw new HttpError(404, 'Page not found.');
      const location = path.join(root, filename);
      const type = filename.endsWith('.html') ? 'text/html; charset=utf-8'
        : filename.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : filename.endsWith('.png') ? 'image/png' : 'text/css; charset=utf-8';
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
      if (filename.endsWith('.html') && request.method === 'GET') {
        const existingVisitorId = cookieValue(request.headers.cookie, 'aloswift_vid');
        const visitorId = /^[a-f0-9-]{36}$/i.test(existingVisitorId) ? existingVisitorId : crypto.randomUUID();
        const visitorCookie = `aloswift_vid=${visitorId}; Path=/; SameSite=Lax; Max-Age=31536000${request.socket.encrypted || process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
        if (!existingVisitorId) headers['Set-Cookie'] = visitorCookie;
        insertVisit.run(visitorId, (requestSession(request) || {}).id || null, `/${filename}`, new Date().toISOString());
      }
      response.writeHead(200, headers);
      if (request.method === 'HEAD') response.end();
      else fs.createReadStream(location).pipe(response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      if (error instanceof HttpError) {
        json(response, error.status, { error: error.message });
        return;
      }
      console.error('Request failed:', error);
      json(response, 500, { error: 'The request could not be completed.' });
    }
  });

  return server;
}

if (require.main === module) {
  createServer().then(server => {
    const port = Number(process.env.PORT || 3000);
    server.listen(port, '0.0.0.0', () => {
      console.log(`AloSwift is listening on http://localhost:${server.address().port}`);
    });
  }).catch(error => {
    console.error('AloSwift could not start:', error);
    process.exitCode = 1;
  });
}

module.exports = { createServer };
