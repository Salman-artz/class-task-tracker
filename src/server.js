const app = require('./app');
const config = require('./config');

app.listen(config.port, () => {
  console.log(`Server berjalan di http://localhost:${config.port}`);
});
