<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Public program content uses route loaders backed by public-catalog server functions and a fresh anonymous publishable client with explicit public-column projections, so SSR includes catalog content without inheriting sessions or privileged access; live schedules remain client-side.
- Self-referencing canonical links belong on public leaf routes, never the root layout, to avoid duplicate canonical tags.
