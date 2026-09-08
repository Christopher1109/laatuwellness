# Läätu Wellness — app móvil

La aplicación web de Läätu puede ejecutarse dentro de Capacitor para iOS y Android.

## Arquitectura

- Web: Vite + TanStack Start + React.
- Backend: TanStack Start + Supabase.
- Pagos: Stripe mediante funciones server-side.
- Shell móvil: Capacitor.

> Importante: Läätu utiliza funciones server-side de TanStack Start para operaciones sensibles, especialmente Stripe. Por ello, la app móvil debe apuntar al despliegue HTTPS de Läätu mediante `CAPACITOR_SERVER_URL` en producción; no se deben empaquetar secretos del servidor dentro de iOS/Android.

## Primera configuración local

1. Instalar dependencias:

```bash
npm install
```

2. Inicializar plataformas nativas una sola vez:

```bash
npx cap add ios
npx cap add android
```

3. Para desarrollo contra el servidor desplegado:

```bash
CAPACITOR_SERVER_URL=https://TU-DOMINIO-DE-LA-APP npm run cap:sync
```

4. Abrir Xcode o Android Studio:

```bash
npm run cap:open:ios
npm run cap:open:android
```

## Producción

Configurar `CAPACITOR_SERVER_URL` con el dominio HTTPS de producción antes de sincronizar. No usar una URL `http://` en producción.

Las claves privadas de Supabase y Stripe deben permanecer exclusivamente en el servidor. Las variables `VITE_*` que lleguen al cliente deben tratarse como públicas.

## PWA vs app nativa

La PWA continúa funcionando en navegador. Dentro de Capacitor, `isNativeApp()` permite diferenciar la app nativa y evitar mostrar el flujo de instalación PWA.
