// Renueva el token de larga duración (caduca a los 60 días).
// Ejecuta `npm run refresh-token` al menos una vez al mes y copia el nuevo token al .env.
import { refreshLongLivedToken } from './instagram.js';

try {
  process.loadEnvFile();
} catch {
  // Sin .env
}

const token = process.env.IG_ACCESS_TOKEN;
if (!token) {
  console.error('Falta IG_ACCESS_TOKEN');
  process.exit(1);
}

const data = await refreshLongLivedToken(token);
const days = Math.round(data.expires_in / 86400);
console.log(`Nuevo token (válido ${days} días):\n${data.access_token}`);
