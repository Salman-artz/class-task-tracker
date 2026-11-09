require('dotenv').config();

const isTest = process.env.NODE_ENV === 'test';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} wajib diisi (lihat .env.example)`);
  return value;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: isTest
    ? process.env.TEST_DATABASE_URL || required('DATABASE_URL')
    : required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  teacherInviteCode: required('TEACHER_INVITE_CODE'),
  corsOrigin: process.env.CORS_ORIGIN || '',
  isTest,
};
