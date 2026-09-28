# AutoDM: tu propio ManyChat para Instagram

Aplicación web para automatizar DMs de Instagram a partir de comentarios, sin pagar ManyChat:

1. **Entras con tu cuenta de Instagram** (login oficial de Meta).
2. **Eliges un reel o publicación** de tu cuenta (o todas) desde una cuadrícula con tus vídeos.
3. Defines **palabras clave** (`PLAN`, `RUTINA`…) o "cualquier comentario".
4. Cuando alguien comenta, la app:
   - **responde en público** al comentario (con varias frases al azar para no parecer spam),
   - le envía un **DM de apertura con botón** ("Envíamelo"),
   - opcionalmente **comprueba si te sigue** y, si no, le pide que te siga,
   - le envía el **mensaje final con el enlace** en un botón.
5. Ves **estadísticas** (comentarios, DMs, clics en el botón, clics en el enlace y %) y un **registro de actividad**.

Usa la **API oficial de Instagram**, que es gratuita. No tiene dependencias: solo necesitas Node.js ≥ 22.13
(la base de datos es SQLite, incluida en Node).

## Arrancar en local

```bash
cp .env.example .env      # rellena los valores (ver abajo)
npm start                 # http://localhost:3000
npm test                  # tests
```

## 1. Requisitos en Instagram

- Cuenta **profesional** (Creador o Empresa): Configuración → Tipo de cuenta.
- Configuración → Mensajes y respuestas a historias → Controles de mensajes → Herramientas conectadas →
  **Permitir acceso a los mensajes**: activado.

## 2. Crear la app en Meta (gratis)

1. En [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create app** → caso de uso
   **"Manage messaging & content on Instagram"**.
2. Panel → **Instagram → API setup with Instagram login**:
   - Copia **Instagram app ID** → `IG_APP_ID` e **Instagram app secret** → `IG_APP_SECRET`.
   - En **Set up Instagram business login → Business login settings**, añade como *OAuth redirect URI*:
     `https://TU-DOMINIO/auth/callback`
   - Rellena también *Deauthorize callback URL*: `https://TU-DOMINIO/auth/deauthorize`
     y *Data deletion request URL*: `https://TU-DOMINIO/auth/data-deletion`.
3. **Configure webhooks**:
   - Callback URL: `https://TU-DOMINIO/webhook`
   - Verify token: el mismo que pongas en `VERIFY_TOKEN`.
   - Suscríbete a los campos **`comments`**, **`messages`** y **`messaging_postbacks`**.
4. En *App settings → Basic*, pon como URL de política de privacidad `https://TU-DOMINIO/privacy.html`
   (la app ya incluye una página).

## 3. Desplegar

Necesitas una URL pública con **HTTPS**: Render, Railway, Fly.io, un VPS… Para probar en local:
`cloudflared tunnel --url http://localhost:3000` o `ngrok http 3000`, y usa esa URL como `BASE_URL`.

Variables de entorno (`.env.example`):

| Variable | Qué es |
|---|---|
| `BASE_URL` | URL pública, p. ej. `https://autodm.tudominio.com` |
| `IG_APP_ID` / `IG_APP_SECRET` | De la app de Meta |
| `VERIFY_TOKEN` | Cadena que inventas para verificar el webhook |
| `SESSION_SECRET` | 32+ caracteres aleatorios; cifra los tokens guardados |
| `DATABASE_PATH` | Fichero SQLite (por defecto `data/app.db`). **Tiene que estar en un disco persistente.** |

## 4. Modo desarrollo → Live

Mientras la app está en **modo desarrollo** solo funciona con cuentas que tengan un rol en la app
(App roles → añade tu Instagram como *Instagram Tester* y acepta la invitación en Instagram →
Configuración → Apps y sitios web). Así puedes probar todo con tu cuenta.

Para que funcione con **cualquier persona que comente**:

1. Pide **Advanced Access** a `instagram_business_manage_messages` e `instagram_business_manage_comments`
   en *App Review* (hay que grabar un vídeo corto enseñando el flujo).
2. Completa la *Business verification* si te la pide.
3. Pasa la app a **Live**.

Es un trámite de una vez y no cuesta dinero.

## Cómo funciona por dentro

| Pieza | Fichero |
|---|---|
| Servidor HTTP, rutas y API del panel | `src/app.js` |
| Login OAuth, DMs, comentarios, perfil | `src/instagram.js` |
| Motor: comentario → respuesta → DM → botón → seguir → enlace | `src/engine.js` |
| Validación y coincidencia de palabras clave | `src/automations.js` |
| Base de datos SQLite (tokens cifrados con AES-256-GCM) | `src/db.js` |
| Renovación automática de tokens (duran 60 días) | `src/jobs.js` |
| Panel web (sin frameworks) | `public/` |

Detalles:

- Los enlaces pasan por `BASE_URL/r/<id>` para contar clics y después redirigen a tu URL.
- Si Instagram rechazara el mensaje con botón, se envía el enlace como texto.
- Cada comentario recibe como máximo un DM (Meta a veces repite webhooks).
- Las automatizaciones de un post concreto tienen prioridad sobre las de "cualquier publicación".

## Límites de Instagram

- Solo se puede enviar **un DM por comentario** y dentro de los **7 días** siguientes.
- Tras pulsar el botón hay una ventana de **24 h** para seguir escribiendo a esa persona.
- Si la persona no te sigue, el DM le llega a "Solicitudes" (igual que con ManyChat).
- Los comentarios de tu propia cuenta se ignoran.
