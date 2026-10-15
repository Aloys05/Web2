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
    created_at TEXT NOT NULL
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
`);

const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const getUserByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
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
    role: user.role,
    profile: safeProfile(user.profile_json),
  };
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
  function requestSession(request) {
    const token = cookieValue(request.headers.cookie, sessionCookie);
    if (!token || token.length > 128) return null;
    const now = Math.floor(Date.now() / 1000);
    removeExpiredSessions.run(now);
    const user = getSessionUser.get(tokenHash(token), now);
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

    if (request.method === 'POST' && (pathname === '/api/auth/signup' || pathname === '/api/auth/login')) {
      assertSameOrigin(request);
      const body = await readBody(request);
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length < 8 || password.length > 128) {
        throw new HttpError(400, 'Enter a valid email and a password between 8 and 128 characters.');
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

    if (pathname.startsWith('/api/') && !sessionUser && !(request.method === 'GET' && pathname === '/api/products')) {
      throw new HttpError(401, 'Please sign in to continue.');
    }

    if (request.method === 'GET' && pathname === '/api/products') {
      const products = listProducts.all().filter(row => profileIsComplete({ role: row.seller_role }, safeProfile(row.seller_profile)));
      return json(response, 200, { products: products.map(publicProduct) });
    }

    if (request.method === 'PUT' && pathname === '/api/profile') {
      assertSameOrigin(request);
      const body = await readBody(request);
      const oldProfile = safeProfile(sessionUser.profile_json);
      const { name, profile } = validateProfileInput(body, sessionUser, oldProfile);
      saveUserProfile.run(name, JSON.stringify(profile), sessionUser.id);
      const updated = getUserById.get(sessionUser.id);
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
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
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
