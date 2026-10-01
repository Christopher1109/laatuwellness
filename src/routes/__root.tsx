import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/hooks/useAuth";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

// Dominio público (para links absolutos que piden Google y redes sociales).
const SITE_URL = "https://laatuwellness.com";

const LOCAL_BUSINESS_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "ExerciseGym",
  "@id": `${SITE_URL}/#negocio`,
  name: "Läätu Wellness",
  alternateName: "LAATU Wellness",
  description:
    "Estudio boutique de Pilates Reformer, 4mat y fisioterapia en San Pedro Garza García, Nuevo León. Grupos de máximo 10 personas.",
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  image: [
    `${SITE_URL}/foto-editorial/laatu-editorial-1.jpg`,
    `${SITE_URL}/foto-editorial/laatu-editorial-2.jpg`,
    `${SITE_URL}/foto-editorial/laatu-editorial-3.jpg`,
  ],
  telephone: "+52 81 1350 6957",
  email: "lore@laatuwellness.com",
  priceRange: "$$",
  address: {
    "@type": "PostalAddress",
    streetAddress: "Av. Manuel Gómez Morín 404, Villas de Aragón",
    addressLocality: "San Pedro Garza García",
    addressRegion: "Nuevo León",
    postalCode: "66273",
    addressCountry: "MX",
  },
  areaServed: ["San Pedro Garza García", "Monterrey", "Nuevo León"],
  sameAs: ["https://instagram.com/laatuwellness"],
  knowsAbout: ["Pilates Reformer", "Pilates mat", "Fisioterapia", "Rehabilitación"],
};

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Läätu Wellness — Estudio de Pilates Reformer en San Pedro Garza García" },
      {
        name: "description",
        content:
          "Läätu Wellness: estudio boutique de Pilates Reformer, 4mat y fisioterapia en San Pedro Garza García, Nuevo León. Grupos de 10 personas. Reserva en línea.",
      },
      { name: "author", content: "Läätu Wellness" },
      { property: "og:title", content: "Läätu Wellness — Pilates Reformer en San Pedro" },
      { property: "og:site_name", content: "Läätu Wellness" },
      { property: "og:locale", content: "es_MX" },
      { property: "og:image", content: `${SITE_URL}/foto-editorial/laatu-editorial-2.jpg` },
      { property: "og:image:width", content: "1600" },
      { property: "og:image:height", content: "1067" },
      { name: "twitter:image", content: `${SITE_URL}/foto-editorial/laatu-editorial-2.jpg` },
      // Datos estructurados para Google: negocio local con dirección y redes.
      { "script:ld+json": LOCAL_BUSINESS_JSON_LD },
      {
        property: "og:description",
        content:
          "Un espacio para respirar, moverte y agradecer el recorrido. Reserva tu clase de Reformer.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#272838" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Läätu" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        // Altone/Nitti son de licencia comercial (ver src/styles.css); en lo
        // que se obtiene esa licencia, se cargan aquí sus alternativas
        // gratuitas declaradas en --font-display / --font-body.
        href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png", type: "image/png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <Outlet />
        <Toaster position="top-center" />
      </AuthProvider>
    </QueryClientProvider>
  );
}
