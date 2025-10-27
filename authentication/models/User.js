const { randomUUID } = require('crypto');

const users = new Map();

class User {
  constructor({ username, password, role, _id }) {
    this._id = _id || randomUUID();
    this.username = username;
    this.password = password;
    this.role = role || 'user';
  }

  async save() {
    if (!this._id) {
      this._id = randomUUID();
    }

    users.set(this.username, { ...this });
    return { ...this };
  }

  static async findOne(query = {}) {
    if (query.username) {
      const user = users.get(query.username);
      return user ? { ...user } : null;
    }

    return null;
  }

  static async create(data) {
    const user = new User(data);
    await user.save();
    return { ...user };
  }

  static async deleteMany() {
    users.clear();
  }
}

module.exports = User;
