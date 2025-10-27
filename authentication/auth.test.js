require('dotenv').config();

const request = require('supertest');
const chai = require('chai');
const { expect } = chai;

const app = require('./server');
const mongoose = require('mongoose');
const User = require('./models/User');
const bcrypt = require('bcryptjs');

const ADMIN_USER = { 
  username: 'proUser',
  password: 'securePwd123'
};
const STANDARD_USER = {
  username: 'standardUser',
  password: 'userPwd'
};
const BAD_CREDENTIALS = { 
  username: 'invalid',
  password: 'user'
};

let adminToken = '';
let standardToken = '';

describe('JWT Authentication & Authorization Flow', function () {
  this.timeout(10000);

  before(async () => {
    try {
      const adminExists = await User.findOne({ username: ADMIN_USER.username });
      if (!adminExists) {
        const hashed = bcrypt.hashSync(ADMIN_USER.password, 10);
        await User.create({
          username: ADMIN_USER.username,
          password: hashed,
          role: 'admin'
        });
        console.log('[TEST SETUP] Admin user created.');
      }

      const userExists = await User.findOne({ username: STANDARD_USER.username });
      if (!userExists) {
        const hashed = bcrypt.hashSync(STANDARD_USER.password, 10);
        await User.create({
          username: STANDARD_USER.username,
          password: hashed,
          role: 'user'
        });
        console.log('[TEST SETUP] Standard user created.');
      }
    } catch (err) {
      console.error('[TEST SETUP ERROR]', err);
      throw err;
    }
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
      console.log('\n[TEST CLEANUP] MongoDB connection closed.');
    }
  });

  describe('POST /api/auth/login', () => {
    it('should successfully log in ADMIN user and store the token (200 OK)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send(ADMIN_USER);

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('token').that.is.a('string');
      adminToken = res.body.token;
    });

    it('should successfully log in STANDARD user and store the token (200 OK)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send(STANDARD_USER);

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('token').that.is.a('string');
      standardToken = res.body.token;
    });

    it('should fail login with 401 for invalid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send(BAD_CREDENTIALS);

      expect(res.status).to.equal(401);
      expect(res.body).to.have.property('message').equal('Authentication failed: Invalid credentials.');
    });
  });

  describe('GET /api/auth/protected/admin-data', () => {
    it('should allow access to admin-data with a valid ADMIN token (200 OK)', async () => {
      const res = await request(app)
        .get('/api/auth/protected/admin-data')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).to.equal(200);
      expect(res.body.data.verifiedClaims.role).to.equal('admin');
    });

    it('should deny access with 403 when authenticated user is NOT an admin', async () => {
      const res = await request(app)
        .get('/api/auth/protected/admin-data')
        .set('Authorization', `Bearer ${standardToken}`);

      expect(res.status).to.equal(403);
      expect(res.body).to.have.property('message').equal("Access Denied: Requires 'admin' role.");
      expect(res.body).to.have.property('userRole').equal('user');
    });

    it('should deny access with 401 when the Authorization header is MISSING', async () => {
      const res = await request(app)
        .get('/api/auth/protected/admin-data');

      expect(res.status).to.equal(401);
      expect(res.body).to.have.property('message').equal('Unauthorized: Bearer token format required.');
    });

    it('should deny access with 403 for an INVALID/TAMPERED token', async () => {
      const tamperedToken = adminToken.slice(0, -2) + 'XX';

      const res = await request(app)
        .get('/api/auth/protected/admin-data')
        .set('Authorization', `Bearer ${tamperedToken}`);

      expect(res.status).to.equal(403);
      expect(res.body).to.have.property('message').equal('Forbidden: Invalid or expired token.');
      expect(res.body).to.have.property('errorName').equal('JsonWebTokenError');
    });
  });

  describe('GET /api/auth/protected/user-status', () => {
    it('should allow access with a valid standard user token (200 OK)', async () => {
      const res = await request(app)
        .get('/api/auth/protected/user-status')
        .set('Authorization', `Bearer ${standardToken}`);

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('message').that.is.a('string');
      expect(res.body.user).to.have.property('role').equal('user');
    });

    it('should allow access with a valid admin token (200 OK)', async () => {
      const res = await request(app)
        .get('/api/auth/protected/user-status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).to.equal(200);
      expect(res.body).to.have.property('message').that.is.a('string');
      expect(res.body.user).to.have.property('role').equal('admin');
    });

    it('should deny access with 401 when the token is missing', async () => {
      const res = await request(app)
        .get('/api/auth/protected/user-status');

      expect(res.status).to.equal(401);
      expect(res.body).to.have.property('message').equal('Unauthorized: Bearer token format required.');
    });
  });
});
