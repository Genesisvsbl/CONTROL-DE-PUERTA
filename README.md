# ControlPuerta 🚚

App para registrar la entrada y salida de vehículos en planta. Funciona en el **celular** y tiene dos roles:

- **Conductor**: avisa que llegó a la puerta (con ubicación GPS), pone nombre, cédula y placa, y luego **solo ve su propio estado** (en puerta → autorizado → salida). No tiene acceso al panel de fábrica.
- **Fábrica / Portería** (protegido con PIN): recibe el aviso en vivo, autoriza el ingreso, registra la salida con lo que salió el vehículo y ve el **tablero** con tiempos, demoras y exportación a CSV/Excel.

Los datos se guardan "en el aire" con **Supabase** (plan gratis), así los dos celulares se sincronizan en tiempo real. Sin Supabase, la app corre en **modo local** (solo para probar en un equipo).

---

## 1) Probar ya mismo (sin instalar nada)

Abre `index.html` en el navegador. Entrará en **modo local**. Puedes probar el flujo completo abriendo dos pestañas: una como Conductor y otra como Fábrica (PIN por defecto: `1234`).

> El modo local NO sincroniza entre celulares distintos. Para eso configura Supabase (paso 2).

---

## 2) Conectar Supabase (gratis, para sincronizar celulares)

1. Crea una cuenta y un proyecto gratis en https://supabase.com
2. En el proyecto: menú izquierdo → **SQL Editor** → **New query** → pega el contenido de `sql/schema.sql` → **Run**.
3. Ve a **Project Settings → API** y copia:
   - **Project URL**
   - **anon public** key
4. Abre `config.js` y pega los dos valores:
   ```js
   SUPABASE_URL: "https://xxxxx.supabase.co",
   SUPABASE_ANON_KEY: "eyJhbGciOi....",
   ```
5. Cambia también el **PIN_FABRICA** y las coordenadas de tu **PLANTA**.
6. Recarga la app: arriba debe decir **● En vivo**.

---

## 3) Subir a Vercel con GitHub

1. Crea un repositorio nuevo en https://github.com (por ejemplo `control-puerta`).
2. Desde esta carpeta, sube el proyecto:
   ```bash
   git init
   git add .
   git commit -m "ControlPuerta v1"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/control-puerta.git
   git push -u origin main
   ```
   (o usa **GitHub Desktop** si prefieres sin comandos).
3. Entra a https://vercel.com → **Add New → Project** → importa el repo `control-puerta`.
4. Framework preset: **Other** (es un sitio estático, no necesita build). Click **Deploy**.
5. Vercel te da un link tipo `https://control-puerta.vercel.app` → ¡ábrelo en el celular!

> Cuando cambies algo, haz `git push` y Vercel vuelve a publicar solo.

### Nota sobre las llaves
La **anon key** de Supabase es pública por diseño (va en el navegador), así que no hay problema en subirla. La seguridad real se maneja con las políticas RLS del archivo `sql/schema.sql`. Si prefieres no subirla, mira la nota en `.gitignore`.

---

## 4) Instalar en el celular como app

Abre el link de Vercel en el celular → menú del navegador → **"Agregar a pantalla de inicio"**. Queda como una app con su ícono.

---

## Estructura

```
control-puerta/
├── index.html        Estructura y pantallas
├── styles.css        Estilos (mobile-first, corporativo)
├── app.js            Lógica: roles, flujo, dashboard, export
├── store.js          Capa de datos (Supabase o modo local)
├── config.js         ← aquí pegas tus llaves y ajustes
├── manifest.webmanifest / icon.svg   (PWA)
├── vercel.json       Config de Vercel
└── sql/schema.sql    SQL para crear la tabla en Supabase
```

## Personalización rápida (todo en `config.js`)
- `PLANTA`: nombre y coordenadas de tu planta (para calcular distancia).
- `PIN_FABRICA`: PIN de acceso al panel de fábrica.
- `DEMORA_PUERTA_MIN`: minutos a partir de los cuales una espera se marca como "demora".

---
Hecho para uso operativo sencillo. Cualquier ajuste (logo, campos extra, foto del vehículo, firma, PDF de minuta) se puede agregar encima de esta base.
