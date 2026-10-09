import { Link, useRouter } from "@tanstack/react-router";
import { SiteLayout, PageHeader } from "@/components/site-chrome";
import { Button } from "@/components/ui/button";

export function PublicCatalogError() {
  const router = useRouter();
  return (
    <SiteLayout>
      <PageHeader eyebrow="Läätu Wellness" title="No pudimos cargar esta página." />
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Button variant="outline" onClick={() => router.invalidate()}>Intentar de nuevo</Button>
      </div>
    </SiteLayout>
  );
}

export function PublicCatalogNotFound() {
  return (
    <SiteLayout>
      <PageHeader eyebrow="404" title="Página no encontrada." />
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <Link to="/programas" className="text-sm text-muted-foreground hover:text-foreground">Ver programas →</Link>
      </div>
    </SiteLayout>
  );
}