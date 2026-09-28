# Auto-DM de Instagram por comentarios (sin ManyChat)

Cuando alguien comenta una palabra clave (p. ej. `PLAN`) en tus publicaciones o reels, este servidor le
envía automáticamente un **mensaje directo** y, opcionalmente, responde al comentario en público
("¡Te lo he enviado por DM!"). Es lo mismo que hace ManyChat, pero usando directamente la
**API oficial de Instagram**, que es gratuita.

Sin dependencias: solo Node.js ≥ 20.12.

## Cómo funciona

1. Meta envía un *webhook* a tu servidor cada vez que alguien comenta.
2. El servidor busca una regla cuya palabra clave aparezca en el comentario (`rules.json`).
3. Envía una **private reply** (DM al autor del comentario) con el texto de la regla.
4. Responde en público al comentario con uno de los textos de `publicReplies`.

Límites de Instagram a tener en cuenta:

- Solo se puede enviar **un DM por comentario** y dentro de los **7 días** siguientes al comentario.
- Tu cuenta tiene que ser **profesional** (Creador o Empresa).
- El DM llega a la bandeja de "Solicitudes" del usuario si no te sigue / no habéis hablado antes (igual que con ManyChat).

## 1. Requisitos previos

- Cuenta de Instagram **profesional** (Configuración → Tipo de cuenta → Cambiar a cuenta profesional).
- En la app de Instagram: Configuración → Mensajes y respuestas a historias → Controles de mensajes →
  **Herramientas conectadas → Permitir acceso a los mensajes**: activado.
- Una cuenta en [developers.facebook.com](https://developers.facebook.com).

## 2. Crear la app en Meta

1. **My Apps → Create app** → caso de uso **"Manage messaging & content on Instagram"** → tipo *Business*.
2. En el panel: **Instagram → API setup with Instagram login**.
3. Copia el **Instagram app secret** → será `APP_SECRET`.
4. En *Generate access tokens* pulsa **Add account**, inicia sesión con tu cuenta de Instagram y
   **Generate token**. Copia el token (empieza por `IG...`) → será `IG_ACCESS_TOKEN`.
   Es un token de larga duración (60 días), ver [renovar el token](#renovar-el-token).
5. Permisos que necesita la app: `instagram_business_basic`, `instagram_business_manage_messages`,
   `instagram_business_manage_comments`.

## 3. Desplegar el servidor

Necesitas una URL pública con HTTPS. Opciones gratuitas o baratas: Render, Railway, Fly.io, un VPS…
Para probar en local puedes usar `ngrok http 3000` o `cloudflared tunnel --url http://localhost:3000`.

```bash
cp .env.example .env            # rellena VERIFY_TOKEN, APP_SECRET e IG_ACCESS_TOKEN
cp rules.example.json rules.json  # pon tus palabras clave y mensajes
npm start
```

En plataformas como Render/Railway define las mismas variables de entorno en su panel en vez de usar `.env`.
Si el disco no es persistente, `data/` (el registro de comentarios ya respondidos) se pierde al reiniciar;
no es grave, porque Instagram no permite dos DMs al mismo comentario.

## 4. Configurar el webhook en Meta

1. Panel de la app → **Instagram → API setup with Instagram login → Configure webhooks**.
2. **Callback URL**: `https://TU-DOMINIO/webhook`
3. **Verify token**: el mismo valor que pusiste en `VERIFY_TOKEN`. Pulsa *Verify and save*.
4. Suscríbete al campo **`comments`** (y `live_comments` si haces directos).
5. En *Generate access tokens*, activa **Webhook subscription** para tu cuenta.

## 5. Modo de pruebas vs. modo publicado

Mientras la app esté en **modo desarrollo**, solo funciona con cuentas que tengan un rol en la app
(App roles → añade tu cuenta de Instagram de prueba como *Instagram Tester* y acepta la invitación en
Instagram → Configuración → Apps y sitios web).

Para que funcione con **cualquier seguidor**, tienes que:

1. Poner la app en modo **Live** (requiere URL de política de privacidad).
2. Pedir **Advanced Access** para `instagram_business_manage_messages` e
   `instagram_business_manage_comments` en *App Review* (grabas un vídeo corto enseñando cómo funciona).
   Para cuentas propias normalmente también hay que completar la *Business verification*.

Es un trámite de una vez; no tiene coste.

## Reglas (`rules.json`)

```json
{
  "publicReplies": ["¡Te lo acabo de enviar por DM, {username}! 📩", "¡Revisa tus mensajes! 💪"],
  "rules": [
    {
      "name": "plan-gratis",
      "keywords": ["PLAN", "RUTINA"],
      "match": "word",
      "mediaIds": [],
      "dm": "¡Hola {username}! Aquí tienes el plan: https://tu-web.com/plan"
    }
  ]
}
```

| Campo | Descripción |
|---|---|
| `keywords` | Palabras que activan la regla. Da igual mayúsculas o tildes. |
| `match` | `word` (por defecto): la palabra aparece suelta en el comentario. `exact`: el comentario es solo esa palabra. `contains`: aparece en cualquier parte, aunque sea dentro de otra palabra. |
| `mediaIds` | Limita la regla a publicaciones concretas (IDs de media). Vacío = todas. |
| `dm` | Texto del mensaje directo. `{username}` se sustituye por `@usuario`. |
| `publicReply` | Opcional. Texto (o lista de textos) para responder en público. `false` para no responder. Si no se pone, se usa uno al azar de `publicReplies`. |

Las reglas se aplican en orden (gana la primera que coincide) y se recargan en cada comentario, así que
puedes editar `rules.json` sin reiniciar.

Para saber el ID de una publicación, pon `DRY_RUN=true`, comenta en ella y míralo en los logs, o consulta
`https://graph.instagram.com/v23.0/me/media?fields=id,caption,permalink&access_token=TU_TOKEN`.

## Renovar el token

El token caduca a los 60 días. Renuévalo al menos una vez al mes:

```bash
npm run refresh-token
```

y copia el nuevo valor en `IG_ACCESS_TOKEN`.

## Probar sin enviar nada

Con `DRY_RUN=true` el servidor solo escribe en los logs lo que habría enviado.

```bash
npm test   # tests unitarios
```
