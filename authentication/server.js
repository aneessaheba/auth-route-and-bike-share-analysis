require('dotenv').config();
const express = require('express');
const authRoutes = require('./authRoutes');

const app = express();

app.use(express.json());
app.use('/api/auth', authRoutes);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ message: 'Unexpected server error.' });
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Authentication service running on port ${port}`);
  });
}
