# Cloudflare deployment checklist

1. Create a Cloudflare account, enable R2, and run `npx wrangler login` locally.
2. Create the `hoggertype-simc-runtime` R2 bucket. No public bucket access or
   `r2.dev` development URL is needed.
3. Commit source changes and build a release using the README commands.
4. Upload the release with `npm run publish:r2`, then `npm run deploy:host`.
5. Verify the hosted `frame.html`, JavaScript, WASM, metadata, and source archive.
   Test a real cast from the frontend against the HTTPS runtime URL.
6. Configure `NEXT_PUBLIC_SIMC_RUNTIME_URL` on the frontend deployment before
   its Next.js build. Pin a release URL; do not use a mutable "latest" alias.

For GitHub Actions, create a dedicated Cloudflare API token scoped to the
deployment account, with Workers Scripts edit, Workers R2 Storage edit, and
Account Settings read permissions. Add it as repository secret
`CLOUDFLARE_API_TOKEN`; add the account ID as variable `CLOUDFLARE_ACCOUNT_ID`.
Use the account dashboard's current permission labels when creating the token.
Set these on the public runtime repository, not the private frontend repository.

The workflow runs for pushes to `main` or manual dispatch. Its build tool and
action versions are pinned. It verifies startup for every supported profile,
packages corresponding source and file checksums, and deploys only when the
account variable is configured. No frontend code or credentials are uploaded
as runtime artifacts.

If a deployment fails midway through upload, the prior production URL stays
valid. Correct the failure and rerun publication for the same artifact set.
Choose an older release URL to roll back a frontend deployment.
